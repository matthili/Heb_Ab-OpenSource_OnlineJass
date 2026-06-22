/**
 * Admin-Service. Sammelt alle Aktionen, die nur Admins ausführen dürfen:
 *   - SMTP-Settings lesen/setzen (verschlüsseltes Passwort)
 *   - Blocklist CRUD
 *   - User-Mgmt: Listen, Rolle setzen, Block/Unblock
 *   - Audit-Log anzeigen
 *
 * Jede Aktion landet selbst im Audit-Log — wichtig, weil Admin-Aktionen
 * potentes Material sind (Plan-Doc Sicherheits-Checkliste #9).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, Role, UserStatus } from "@prisma/client";

import { systemLogBuffer, type SystemLogEntry } from "../../common/system-log.buffer.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  AddBlocklistDto,
  ListAuditQuery,
  ListUsersQuery,
  SetUserRoleDto,
  SetUserStatusDto,
  SmtpSettingsDto,
} from "./admin.dto.js";
import { MailService } from "../mail/mail.service.js";
import { SmtpSettingsService } from "../mail/smtp-settings.service.js";

export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  /** `false` = wartet auf Freischaltung (E-Mail-Link ODER Admin im LAN-Mode). */
  emailVerified: boolean;
  /** Admin-Notiz (z.B. „Rookie3000 = Martin Meier"); nur für Admins. */
  adminNote: string | null;
  createdAt: string;
}

export interface AdminAuditEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  target: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: string;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly smtp: SmtpSettingsService,
    private readonly mail: MailService
  ) {}

  // ─── SMTP ──────────────────────────────────────────────────────────

  /**
   * Aktuelle SMTP-Settings — Passwort wird NICHT zurückgegeben (auch
   * Admins sehen es nie im Klartext). Stattdessen ein Flag, ob ein
   * Passwort gesetzt ist.
   */
  async getSmtp(): Promise<{
    host: string;
    port: number;
    user: string | null;
    from: string;
    noReply: boolean;
    hasPassword: boolean;
  }> {
    // Effektiv aktive Konfiguration (Env-Defaults + DB-Overrides gemerged) — so
    // sieht der Admin im Panel auch die per `.env` gesetzten Werte und kann ein
    // einzelnes Feld gefahrlos ändern, ohne die übrigen zu „verlieren". Das
    // Passwort bleibt write-only (nur `hasPassword`).
    return this.mail.effectiveConfig();
  }

  async updateSmtp(actorId: string, dto: SmtpSettingsDto): Promise<void> {
    await this.smtp.update(actorId, dto);
    await this.audit.record({
      action: "admin.smtp.update",
      actorId,
      meta: {
        changed: Object.keys(dto).filter((k) => k !== "password"),
        passwordChanged: dto.password !== undefined,
      },
    });
  }

  // ─── Blocklist ─────────────────────────────────────────────────────

  async listBlocklist(): Promise<{ pattern: string; reason: string | null; createdAt: string }[]> {
    const rows = await this.prisma.blocklist.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      pattern: r.pattern,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addBlocklistPattern(actorId: string, dto: AddBlocklistDto): Promise<void> {
    const existing = await this.prisma.blocklist.findUnique({ where: { pattern: dto.pattern } });
    if (existing) {
      throw new ConflictException(`Pattern '${dto.pattern}' existiert bereits.`);
    }
    await this.prisma.blocklist.create({
      data: { pattern: dto.pattern, ...(dto.reason ? { reason: dto.reason } : {}) },
    });
    await this.audit.record({
      action: "admin.blocklist.add",
      actorId,
      target: dto.pattern,
      meta: { reason: dto.reason ?? null },
    });
  }

  async removeBlocklistPattern(actorId: string, pattern: string): Promise<void> {
    const removed = await this.prisma.blocklist.delete({ where: { pattern } }).catch(() => null);
    if (!removed) throw new NotFoundException(`Pattern '${pattern}' nicht gefunden`);
    await this.audit.record({
      action: "admin.blocklist.remove",
      actorId,
      target: pattern,
    });
  }

  // ─── User-Mgmt ─────────────────────────────────────────────────────

  async listUsers(query: ListUsersQuery): Promise<AdminUserView[]> {
    const where: Prisma.UserWhereInput = {};
    if (query.q) {
      where.OR = [
        { email: { contains: query.q, mode: "insensitive" } },
        { name: { contains: query.q, mode: "insensitive" } },
      ];
    }
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        emailVerified: true,
        adminNote: true,
        createdAt: true,
      },
    });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      emailVerified: u.emailVerified,
      adminNote: u.adminNote,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  /**
   * Wirft, wenn `targetId` der einzige verbliebene aktive Admin ist — Schutz
   * davor, den Admin-Bereich für ALLE auszusperren (Degradieren/Sperren/Löschen
   * des Letzten). Zählt andere ADMINs mit Status ACTIVE.
   */
  private async assertNotLastActiveAdmin(targetId: string): Promise<void> {
    const otherActiveAdmins = await this.prisma.user.count({
      where: { role: "ADMIN", status: "ACTIVE", id: { not: targetId } },
    });
    if (otherActiveAdmins === 0) {
      throw new BadRequestException(
        "Der letzte aktive Admin kann nicht degradiert, gesperrt oder gelöscht werden."
      );
    }
  }

  async setUserRole(actorId: string, targetId: string, dto: SetUserRoleDto): Promise<void> {
    if (actorId === targetId && dto.role !== "ADMIN") {
      // Schutz vor versehentlichem Self-Demote — sonst wäre der letzte
      // Admin gleich kein Admin mehr.
      throw new BadRequestException("Admins dürfen sich nicht selbst degradieren.");
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!target) throw new NotFoundException(`User ${targetId} nicht gefunden`);
    if (target.role === "ADMIN" && dto.role !== "ADMIN") {
      await this.assertNotLastActiveAdmin(targetId);
    }
    await this.prisma.user.update({
      where: { id: targetId },
      data: { role: dto.role },
    });
    await this.audit.record({
      action: "admin.user.role",
      actorId,
      target: targetId,
      meta: { from: target.role, to: dto.role },
    });
  }

  async setUserStatus(actorId: string, targetId: string, dto: SetUserStatusDto): Promise<void> {
    if (actorId === targetId) {
      throw new BadRequestException("Du kannst deinen eigenen Status nicht ändern.");
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { status: true, role: true },
    });
    if (!target) throw new NotFoundException(`User ${targetId} nicht gefunden`);
    if (target.role === "ADMIN" && dto.status !== "ACTIVE") {
      await this.assertNotLastActiveAdmin(targetId);
    }
    await this.prisma.user.update({
      where: { id: targetId },
      data: { status: dto.status },
    });
    if (dto.status === "BLOCKED") {
      // Aktive Sessions des blockierten Users invalidieren — sonst läuft
      // er noch bis zum Cookie-Cache-Refresh weiter rum.
      await this.prisma.session.deleteMany({ where: { userId: targetId } });
    }
    await this.audit.record({
      action: "admin.user.status",
      actorId,
      target: targetId,
      meta: { from: target.status, to: dto.status },
    });
  }

  /**
   * Konto freischalten: setzt `emailVerified = true`, wodurch Better Auth
   * Sessions zulässt. Das ist der „Freischalten"-Knopf im LAN-Mode (statt
   * E-Mail-Verifikation), funktioniert aber auch zum manuellen Bestätigen
   * eines hängengebliebenen E-Mail-Kontos. Idempotent.
   */
  async approveUser(actorId: string, targetId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { emailVerified: true },
    });
    if (!target) throw new NotFoundException(`User ${targetId} nicht gefunden`);
    if (target.emailVerified) return; // bereits freigeschaltet → no-op
    await this.prisma.user.update({
      where: { id: targetId },
      data: { emailVerified: true },
    });
    await this.audit.record({ action: "admin.user.approve", actorId, target: targetId, meta: {} });
  }

  /** Admin-Notiz pro Nutzer setzen/leeren (z.B. „Rookie3000 = Martin Meier"). */
  async setAdminNote(actorId: string, targetId: string, note: string | null): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException(`User ${targetId} nicht gefunden`);
    const trimmed = note?.trim() ?? "";
    await this.prisma.user.update({
      where: { id: targetId },
      data: { adminNote: trimmed === "" ? null : trimmed },
    });
    await this.audit.record({ action: "admin.user.note", actorId, target: targetId, meta: {} });
  }

  // ─── Audit-Log-View ────────────────────────────────────────────────

  async listAudit(query: ListAuditQuery): Promise<AdminAuditEntry[]> {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.actionPrefix) where.action = { startsWith: query.actionPrefix };
    if (query.actorId) where.actorId = query.actorId;
    if (query.before) where.createdAt = { lt: new Date(query.before) };

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      include: { actor: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      actorId: r.actorId,
      actorName: r.actor?.name ?? null,
      action: r.action,
      target: r.target,
      meta: r.meta,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ─── System-Log (flüchtiger WARN+-Ringpuffer) ──────────────────────

  /**
   * Letzte WARN/ERROR/FATAL-Logzeilen (neueste zuerst), optional auf ein
   * Mindest-Level gefiltert. Rein In-Memory — nach einem Neustart leer.
   */
  getSystemLog(minLevel?: "warn" | "error"): SystemLogEntry[] {
    const entries = systemLogBuffer.list();
    if (minLevel === "error") return entries.filter((e) => e.level >= 50);
    return entries;
  }

  // ─── Quitter-Statistik ──────────────────────────────────────────────

  /**
   * Aggregierte Quitter-Statistik aus `game.abandoned`-Audit-Einträgen.
   * Wir bauen ein Ranking nach `hadHumanOpponents`-Aussteigern: das sind
   * die Spieler, die echten Mitspielern den Spaß verderben. KI-Tische
   * abandonen ist nicht so schlimm, zählen aber im Counter mit.
   *
   * Sortierung: zuerst nach „mit Mitspielern", dann nach total.
   */
  async listQuitters(limit: number = 50): Promise<AdminQuitterEntry[]> {
    // Wir lesen alle `game.abandoned`-Einträge und gruppieren in Node-Code,
    // weil das Auditlog-Schema kein JSON-Index hat. Bei realistischer
    // Quitter-Größenordnung (< 10k Einträge) reicht das.
    const rows = await this.prisma.auditLog.findMany({
      where: { action: "game.abandoned" },
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { id: true, name: true } } },
    });

    type Aggregate = {
      userId: string;
      userName: string | null;
      total: number;
      withHumans: number;
      lastAbandonAt: string;
    };
    const map = new Map<string, Aggregate>();
    for (const r of rows) {
      if (!r.actorId) continue;
      const meta = r.meta as { hadHumanOpponents?: boolean } | null;
      const withHumans = meta?.hadHumanOpponents === true ? 1 : 0;
      const existing = map.get(r.actorId);
      if (existing) {
        existing.total += 1;
        existing.withHumans += withHumans;
        // rows ist desc sortiert — der erste Eintrag pro userId ist der
        // jüngste, weitere Updates sind älter → nichts zu tun.
      } else {
        map.set(r.actorId, {
          userId: r.actorId,
          userName: r.actor?.name ?? null,
          total: 1,
          withHumans,
          lastAbandonAt: r.createdAt.toISOString(),
        });
      }
    }
    const out = [...map.values()];
    out.sort((a, b) => {
      if (b.withHumans !== a.withHumans) return b.withHumans - a.withHumans;
      return b.total - a.total;
    });
    return out.slice(0, limit);
  }
}

export interface AdminQuitterEntry {
  userId: string;
  userName: string | null;
  /** Anzahl aller game.abandoned-Einträge dieses Users. */
  total: number;
  /** Davon: bei Spielen mit anderen Menschen (= echter Spaßverderber-Score). */
  withHumans: number;
  /** ISO-Timestamp der letzten Aussteig-Aktion. */
  lastAbandonAt: string;
}
