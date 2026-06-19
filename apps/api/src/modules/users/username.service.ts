/**
 * Spielername (User.name) ändern — mit Historie + zwei Cooldowns.
 *
 * Warum eigener Endpunkt statt Better-Auth `/update-user`? Die Cooldown- und
 * Freigabe-Logik braucht volle Kontrolle (DB-Queries + eigene Fehlermeldungen).
 * Da `cookieCache` aus ist (Better Auth liest den User pro Request frisch),
 * ist ein direktes Prisma-Update von `user.name` sicher — keine stale Session.
 * Die Eindeutigkeit (`User.name @unique`) bleibt als DB-Backstop bestehen.
 *
 * **Änderungs-Cooldown** (`nameChangeCooldownHours`, Default 168 h): Nach einer
 * Umbenennung muss man warten, bevor man wieder umbenennen darf. Der ERSTE
 * Wechsel (vom Registrierungsnamen weg) ist frei.
 *
 * **Freigabe-Cooldown** (`nameReleaseCooldownHours`, Default 168 h): Ein gerade
 * von jemand ANDEREM freigegebener Name bleibt eine Weile gesperrt, damit nicht
 * sofort jemand die Identität übernimmt. Eigene alte Namen darf man jederzeit
 * zurücknehmen.
 */
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface NameCooldownSettings {
  /** Stunden, die nach einer Umbenennung bis zur nächsten vergehen müssen. */
  changeHours: number;
  /** Stunden, die ein freigegebener Name für andere gesperrt bleibt. */
  releaseHours: number;
}

export interface NameHistoryEntry {
  name: string;
  fromAt: string;
  /** null = aktuell aktiver Name. */
  untilAt: string | null;
}

const KEY = {
  changeHours: "users.nameChangeCooldownHours",
  releaseHours: "users.nameReleaseCooldownHours",
} as const;

export const NAME_COOLDOWN_DEFAULTS: NameCooldownSettings = {
  changeHours: 168, // 7 Tage
  releaseHours: 168, // 7 Tage
};

const NAME_MIN = 2;
const NAME_MAX = 32;

@Injectable()
export class UsernameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  // ─── Admin-Einstellungen (AdminSetting-Key/Value) ──────────────────

  async getCooldowns(): Promise<NameCooldownSettings> {
    const rows = await this.prisma.adminSetting.findMany({
      where: { key: { in: Object.values(KEY) } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    return {
      changeHours: readNonNegInt(byKey.get(KEY.changeHours), NAME_COOLDOWN_DEFAULTS.changeHours),
      releaseHours: readNonNegInt(byKey.get(KEY.releaseHours), NAME_COOLDOWN_DEFAULTS.releaseHours),
    };
  }

  async updateCooldowns(
    actorId: string,
    update: { changeHours?: number | undefined; releaseHours?: number | undefined }
  ): Promise<void> {
    const changed: Record<string, number> = {};
    for (const field of ["changeHours", "releaseHours"] as const) {
      const v = update[field];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) continue;
      const key = KEY[field];
      await this.prisma.adminSetting.upsert({
        where: { key },
        create: { key, value: { value: v }, updatedBy: actorId },
        update: { value: { value: v }, updatedBy: actorId },
      });
      changed[field] = v;
    }
    if (Object.keys(changed).length === 0) return;
    await this.audit.record({ action: "admin.nameSettings.update", actorId, meta: changed });
  }

  // ─── Historie ──────────────────────────────────────────────────────

  /** Bisherige Namen (chronologisch) für die Profil-Anzeige. */
  async getHistory(userId: string): Promise<NameHistoryEntry[]> {
    const rows = await this.prisma.usernameHistory.findMany({
      where: { userId },
      orderBy: { fromAt: "asc" },
    });
    return rows.map((r) => ({
      name: r.name,
      fromAt: r.fromAt.toISOString(),
      untilAt: r.untilAt?.toISOString() ?? null,
    }));
  }

  /**
   * Legt den initialen offenen Historie-Eintrag an (bei Registrierung). No-op,
   * wenn der User schon einen offenen Eintrag hat (idempotent).
   */
  async recordInitialName(userId: string, name: string): Promise<void> {
    const open = await this.prisma.usernameHistory.findFirst({ where: { userId, untilAt: null } });
    if (open) return;
    await this.prisma.usernameHistory.create({ data: { userId, name } });
  }

  // ─── Namens-Änderung ───────────────────────────────────────────────

  async changeName(userId: string, rawName: string): Promise<{ name: string }> {
    const name = rawName.trim();
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      throw new BadRequestException(`Der Name muss ${NAME_MIN}–${NAME_MAX} Zeichen lang sein.`);
    }

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, createdAt: true },
    });
    if (!me) throw new BadRequestException("Benutzer nicht gefunden.");
    if (name === me.name) {
      throw new BadRequestException("Das ist bereits dein aktueller Name.");
    }

    const cooldowns = await this.getCooldowns();
    const now = Date.now();

    // 1) Änderungs-Cooldown — nur, wenn schon einmal umbenannt wurde (es gibt
    //    einen geschlossenen Eintrag) und der offene Eintrag noch zu jung ist.
    if (cooldowns.changeHours > 0) {
      const [open, closedCount] = await Promise.all([
        this.prisma.usernameHistory.findFirst({ where: { userId, untilAt: null } }),
        this.prisma.usernameHistory.count({ where: { userId, untilAt: { not: null } } }),
      ]);
      if (open && closedCount > 0) {
        const nextAt = open.fromAt.getTime() + cooldowns.changeHours * 3_600_000;
        if (now < nextAt) {
          throw new ConflictException(
            `Du hast deinen Namen kürzlich geändert. Eine erneute Änderung ist erst ab ${fmt(nextAt)} möglich.`
          );
        }
      }
    }

    // 2) Eindeutigkeit — hat ein ANDERER User diesen Namen aktuell? (Backstop:
    //    DB-@unique.) Case-insensitive, damit „Balu"/„balu" nicht kollidieren.
    const taken = await this.prisma.user.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, id: { not: userId } },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException("Dieser Name ist bereits vergeben.");
    }

    // 3) Freigabe-Cooldown — wurde der Name kürzlich von jemand ANDEREM
    //    freigegeben? (Eigene alte Namen darf man sofort zurücknehmen.)
    if (cooldowns.releaseHours > 0) {
      const since = new Date(now - cooldowns.releaseHours * 3_600_000);
      const recentlyReleased = await this.prisma.usernameHistory.findFirst({
        where: {
          name: { equals: name, mode: "insensitive" },
          userId: { not: userId },
          untilAt: { gt: since },
        },
        orderBy: { untilAt: "desc" },
      });
      if (recentlyReleased?.untilAt) {
        const releasedAt = recentlyReleased.untilAt.getTime();
        const availableAt = releasedAt + cooldowns.releaseHours * 3_600_000;
        const hoursAgo = Math.max(1, Math.round((now - releasedAt) / 3_600_000));
        throw new ConflictException(
          `Dieser Name wurde bis vor ${hoursAgo} Stunden von einem anderen Spieler verwendet. ` +
            `Er kann erst ab ${fmt(availableAt)} wieder verwendet werden.`
        );
      }
    }

    // 4) Alles ok → Name setzen + Historie fortschreiben (atomar).
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { name } });
      const open = await tx.usernameHistory.findFirst({ where: { userId, untilAt: null } });
      if (open) {
        await tx.usernameHistory.update({ where: { id: open.id }, data: { untilAt: new Date() } });
      } else {
        // Alt-User ohne Historie: den bisherigen Namen rückwirkend schließen.
        await tx.usernameHistory.create({
          data: { userId, name: me.name, fromAt: me.createdAt, untilAt: new Date() },
        });
      }
      await tx.usernameHistory.create({ data: { userId, name } });
    });

    await this.audit.record({
      action: "user.name.change",
      actorId: userId,
      target: userId,
      meta: { from: me.name, to: name },
    });
    return { name };
  }
}

function readNonNegInt(raw: unknown, fallback: number): number {
  if (raw && typeof raw === "object" && "value" in raw) {
    const v = (raw as { value: unknown }).value;
    if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0) return v;
  }
  return fallback;
}

/** Datums-Format wie in der Spec: „16.07.2026 um 20:22". */
function fmt(epochMs: number): string {
  const d = new Date(epochMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} um ${p(d.getHours())}:${p(d.getMinutes())}`;
}
