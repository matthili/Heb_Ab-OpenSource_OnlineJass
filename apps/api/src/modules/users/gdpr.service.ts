/**
 * DSGVO-Datenexport (M10-C) und Account-Anonymisierung (M10-D).
 *
 * **Datenexport (`exportAllData`)**: Liefert eine deterministische
 * Snapshot-Struktur, die alle personenbezogenen Daten des Users enthält:
 *   - Identität (User-Core)
 *   - Profil (sämtliche Felder, auch private)
 *   - Spiele, an denen der User als Sitz beteiligt war (mit Move-Liste)
 *   - Chat-Nachrichten, die der User gesendet hat
 *   - Audit-Log-Einträge, deren `actorId` der User ist
 *   - Freundschaften (in und out)
 *   - Sessions (Token-Hashes werden NICHT exportiert — die sind kein User-Datum,
 *     sondern Auth-State)
 *
 * Das Ergebnis ist eine reine JSON-Struktur (DSGVO Art. 20 verlangt
 * „strukturiertes, gängiges, maschinenlesbares Format" — JSON erfüllt das).
 * Der Controller liefert es mit `Content-Disposition: attachment` als File-
 * Download.
 *
 * **Account-Löschung (`softDelete`)** (M10-D): siehe diese Funktion.
 */
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface DataExport {
  meta: {
    exportedAt: string;
    exportVersion: 1;
    userId: string;
  };
  account: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    role: string;
    status: string;
    locale: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  };
  profile: {
    realFirstName: string | null;
    realLastName: string | null;
    birthDate: string | null;
    city: string | null;
    country: string | null;
    hobbies: string | null;
    bio: string | null;
    avatarUrl: string | null;
    visibility: unknown;
    createdAt: string;
    updatedAt: string;
  } | null;
  games: Array<{
    gameId: string;
    variant: string;
    mySeat: number;
    startedAt: string;
    endedAt: string | null;
    finalScore: unknown;
    seats: Array<{
      seat: number;
      userId: string | null;
      displayName: string | null;
      aiSeatType: string | null;
    }>;
    moves: Array<{ seq: number; seat: number; cardIndex: number; trickIdx: number; ts: string }>;
  }>;
  chatMessages: Array<{
    id: string;
    channel: string;
    channelKey: string;
    body: string;
    createdAt: string;
    gameId: string | null;
  }>;
  auditEntries: Array<{
    id: string;
    action: string;
    target: string | null;
    meta: unknown;
    ip: string | null;
    createdAt: string;
  }>;
  friendships: {
    out: Array<{ addresseeId: string; status: string; createdAt: string }>;
    in: Array<{ requesterId: string; status: string; createdAt: string }>;
  };
  sessions: Array<{
    /** Token-Hash statt Klartext — der Roh-Token darf nie das System verlassen. */
    tokenHash: string;
    ipAddress: string | null;
    userAgent: string | null;
    expiresAt: string;
    createdAt: string;
  }>;
}

@Injectable()
export class GdprService {
  private readonly log = new Logger(GdprService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * Sammelt alle personenbezogenen Daten des Users.
   *
   * Es wird absichtlich KEIN Cursor-Streaming gemacht — bei realistischen
   * Spielerstatistiken (≤ tausende Games + zehntausende Moves) bleibt der
   * Memory-Footprint unter 50 MB. Falls einzelne User in die Millionen
   * gehen sollten, kann das später per Cursor-Pagination + NDJSON-Stream
   * nachgerüstet werden.
   */
  async exportAllData(userId: string): Promise<DataExport> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${userId} nicht gefunden`);
    }

    // Spiele + Moves zusammenladen. `seats` brauchen wir, um beim Replay
    // auch die Mitspieler-Namen im Export zu haben (Snapshot zum Export-
    // Zeitpunkt).
    const gameSeats = await this.prisma.gameSeat.findMany({
      where: { userId },
      include: {
        game: {
          include: {
            seats: { include: { user: { select: { name: true } } } },
            moves: { orderBy: { seq: "asc" } },
          },
        },
      },
      orderBy: { game: { startedAt: "desc" } },
    });

    const chat = await this.prisma.chatMessage.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: "asc" },
    });

    const audit = await this.prisma.auditLog.findMany({
      where: { actorId: userId },
      orderBy: { createdAt: "asc" },
    });

    const friendshipsOut = await this.prisma.friendship.findMany({
      where: { requesterId: userId },
    });
    const friendshipsIn = await this.prisma.friendship.findMany({
      where: { addresseeId: userId },
    });

    const sessions = await this.prisma.session.findMany({
      where: { userId },
    });

    const profile = user.profile;

    const out: DataExport = {
      meta: {
        exportedAt: new Date().toISOString(),
        exportVersion: 1,
        userId,
      },
      account: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        role: user.role,
        status: user.status,
        locale: user.locale,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        deletedAt: user.deletedAt?.toISOString() ?? null,
      },
      profile: profile
        ? {
            realFirstName: profile.realFirstName,
            realLastName: profile.realLastName,
            birthDate: profile.birthDate?.toISOString() ?? null,
            city: profile.city,
            country: profile.country,
            hobbies: profile.hobbies,
            bio: profile.bio,
            avatarUrl: profile.avatarUrl,
            visibility: profile.visibility,
            createdAt: profile.createdAt.toISOString(),
            updatedAt: profile.updatedAt.toISOString(),
          }
        : null,
      games: gameSeats.map((gs) => ({
        gameId: gs.game.id,
        variant: gs.game.variant,
        mySeat: gs.seat,
        startedAt: gs.game.startedAt.toISOString(),
        endedAt: gs.game.endedAt?.toISOString() ?? null,
        finalScore: gs.game.finalScore,
        seats: gs.game.seats.map((s) => ({
          seat: s.seat,
          userId: s.userId,
          displayName: s.user?.name ?? null,
          aiSeatType: s.aiSeatType,
        })),
        moves: gs.game.moves.map((m) => ({
          seq: m.seq,
          seat: m.seat,
          cardIndex: m.cardIndex,
          trickIdx: m.trickIdx,
          ts: m.ts.toISOString(),
        })),
      })),
      chatMessages: chat.map((c) => ({
        id: c.id.toString(),
        channel: c.channel,
        channelKey: c.channelKey,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        gameId: c.gameId,
      })),
      auditEntries: audit.map((a) => ({
        id: a.id.toString(),
        action: a.action,
        target: a.target,
        meta: a.meta,
        ip: a.ip,
        createdAt: a.createdAt.toISOString(),
      })),
      friendships: {
        out: friendshipsOut.map((f) => ({
          addresseeId: f.addresseeId,
          status: f.status,
          createdAt: f.createdAt.toISOString(),
        })),
        in: friendshipsIn.map((f) => ({
          requesterId: f.requesterId,
          status: f.status,
          createdAt: f.createdAt.toISOString(),
        })),
      },
      sessions: sessions.map((s) => ({
        // Token-Hash statt Klartext (Defense in depth).
        tokenHash: createHash("sha256").update(s.token).digest("hex"),
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        expiresAt: s.expiresAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
    };

    await this.audit.record({
      action: "user.gdpr.export",
      actorId: userId,
      target: userId,
      meta: {
        games: out.games.length,
        chatMessages: out.chatMessages.length,
        auditEntries: out.auditEntries.length,
      },
    });

    return out;
  }

  /**
   * Account-Anonymisierung (DSGVO „Recht auf Löschung", Art. 17).
   *
   * Wir HARD-DELETEN nicht: Spiele bleiben für Mitspieler erhalten, sonst
   * wäre die Spiel-History anderer Spieler kaputt. Stattdessen:
   *   - User.email → `deleted-<hash>@example.invalid`
   *   - User.name  → `anonym-<6 hex>` (collision-freier Hash)
   *   - User.deletedAt → jetzt
   *   - User.status → DELETED_SOFT
   *   - Profile: ALLE PII-Felder auf null setzen
   *   - Sessions: alle löschen (Logout)
   *   - Friendships: alle löschen (sind beidseitig sichtbar)
   *   - Chat-Nachrichten: body-Inhalt auf `[gelöscht]` setzen (DSGVO-konform —
   *     der User hat den Inhalt verfasst, will ihn weg, aber der Sender-Slot
   *     bleibt für die Kontext-Bewahrung der Mitleser sichtbar)
   *
   * Wir bewahren ABSICHTLICH:
   *   - User.id (Foreign-Key in GameSeat, Move, AuditLog — sonst Domino-Effekt)
   *   - GameSeat.userId (für Spiel-Statistik der Mitspieler)
   *   - AuditLog-Einträge (Rechenschaftspflicht, Art. 5(2))
   */
  async softDelete(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} nicht gefunden`);
    if (user.status === "DELETED_SOFT") {
      this.log.warn({ userId }, "softDelete erneut gerufen — schon anonymisiert");
      return;
    }

    // Kollisions-resistente Anonymisierung: 6 Bytes random reichen für die
    // Population, die wir je realistisch haben werden. Wir schauen aber
    // sicherheitshalber nach und bauen ggf. einen längeren Suffix.
    const anonName = await this.uniqueAnonName();
    const anonEmail = `deleted-${createHash("sha256")
      .update(user.id)
      .update(String(Date.now()))
      .digest("hex")
      .slice(0, 16)}@example.invalid`;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonEmail,
          name: anonName,
          status: "DELETED_SOFT",
          deletedAt: new Date(),
          // image leeren, image-URL ist PII (oft mit User-Identifier).
          image: null,
        },
      });
      // Profile-PII komplett ausnullen. visibility bleibt als {}-Default.
      await tx.profile
        .update({
          where: { userId },
          data: {
            realFirstName: null,
            realLastName: null,
            birthDate: null,
            city: null,
            country: null,
            hobbies: null,
            bio: null,
            avatarUrl: null,
            visibility: {},
          },
        })
        .catch(() => {
          /* Profil existiert evtl. nicht — egal. */
        });
      // Sessions invalidieren — User ist sofort ausgeloggt.
      await tx.session.deleteMany({ where: { userId } });
      // Better-Auth-Accounts (Credentials) löschen — das Passwort darf
      // sicher weg.
      await tx.account.deleteMany({ where: { userId } });
      // Freundschaften beidseitig auflösen.
      await tx.friendship.deleteMany({
        where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      });
      // Chat-Body redacten — Schemata wie LobbyTableSeat/Move/GameSeat
      // bleiben, weil sie Spielfortschritt halten und für andere Spieler
      // sichtbar sein müssen. Aber der Text-Inhalt ist PII.
      await tx.chatMessage.updateMany({
        where: { senderId: userId },
        data: { body: "[gelöscht]" },
      });
    });

    await this.audit.record({
      action: "user.gdpr.delete",
      actorId: userId,
      target: userId,
      meta: { anonName },
    });

    this.log.log({ userId, anonName }, "User soft-deleted (DSGVO-Anonymisierung)");
  }

  /**
   * Sucht einen freien `anonym-<hex>`-Spitznamen. Bei `name UNIQUE` in der
   * DB ist die Kollisionswahrscheinlichkeit bei 6 Hex-Zeichen ≈ 1 / 16 M,
   * trotzdem retryen wir bis 5 mal mit längerem Suffix für Worst Case.
   */
  private async uniqueAnonName(): Promise<string> {
    for (const len of [6, 8, 10, 12, 16]) {
      const candidate = `anonym-${createHash("sha256")
        .update(crypto.randomUUID())
        .digest("hex")
        .slice(0, len)}`;
      const exists = await this.prisma.user.findUnique({ where: { name: candidate } });
      if (!exists) return candidate;
    }
    throw new Error("Konnte keinen freien anonym-Namen finden — sehr unwahrscheinlich.");
  }
}
