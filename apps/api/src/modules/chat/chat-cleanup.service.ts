/**
 * Lobby-Chat-Cleanup (Plan-Doc §4 + M8).
 *
 * **Was passiert**: alle 5 Minuten (im Default) prüfen wir, ob es
 * Lobby-Nachrichten gibt, die älter als 12 Stunden sind. Wenn ja:
 *   1. Sie werden in die `ArchivedChatMessage`-Tabelle verschoben
 *      (transaktional: INSERT + DELETE in einer Transaction, damit es
 *      keinen Datenverlust gibt, falls die DB mittendrin abreißt).
 *   2. Sammel-Eintrag im AuditLog (Anzahl + Zeitspanne) — damit der
 *      Cleanup nachvollziehbar bleibt, ohne dass Audit-Spam entsteht.
 *
 * Game- und DM-Chat bleiben dauerhaft im `ChatMessage` (Plan-Doc §4:
 * Replays + Profil-History). Sie werden hier nicht angefasst.
 *
 * **Warum archivieren statt löschen?** Spec verlangt ausdrücklich eine
 * separate Archiv-Tabelle. Vorteil: die kommende Profil-Konversations-
 * History kann auch alte Lobby-Beiträge anzeigen, und Audit-Spuren
 * (z.B. „wer hat damals X gesagt") sind weiter rekonstruierbar.
 *
 * **Lifecycle**: `setInterval` im OnModuleInit, `clearInterval` im
 * OnModuleDestroy. Per env `DISABLE_CHAT_CLEANUP=1` deaktivierbar
 * (Integration-Tests deaktivieren das).
 *
 * **Skalierung**: Single-Instance OK für M11; bei Multi-Instance braucht
 * es einen Redis-Lock pro Sweep — siehe AutoFillService für dasselbe
 * Pattern.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ChatChannel } from "@prisma/client";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 Minuten
const RETENTION_HOURS = 12;

@Injectable()
export class ChatCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ChatCleanupService.name);
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  onModuleInit(): void {
    if (process.env["DISABLE_CHAT_CLEANUP"] === "1") {
      this.log.log("Chat-Cleanup deaktiviert (DISABLE_CHAT_CLEANUP=1)");
      return;
    }
    this.intervalHandle = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, "Chat-Cleanup-Tick failed"));
    }, TICK_INTERVAL_MS);
    this.intervalHandle.unref?.();
    this.log.log({ intervalMs: TICK_INTERVAL_MS }, "Chat-Cleanup läuft");
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Ein Sweep-Lauf. Public für Tests (deterministisches Anstoßen).
   * Returnt die Zahl archivierter (= verschobener) Nachrichten.
   */
  async tick(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_HOURS * 60 * 60 * 1000);
    const candidates = await this.prisma.chatMessage.findMany({
      where: { channel: ChatChannel.LOBBY, createdAt: { lt: cutoff } },
      select: {
        id: true,
        channel: true,
        channelKey: true,
        senderId: true,
        body: true,
        createdAt: true,
        gameId: true,
      },
      orderBy: { createdAt: "asc" },
    });
    if (candidates.length === 0) return 0;

    const oldest = candidates[0]!.createdAt;
    const newest = candidates[candidates.length - 1]!.createdAt;

    // Transaktional: erst ins Archiv kopieren, dann aus dem Live-Chat löschen.
    // Ohne Transaction bestünde bei DB-Abriss die Gefahr von Datenverlust
    // (gelöscht, aber nicht archiviert). createMany ist für sich atomar,
    // aber die Zwei-Schritte-Sequenz braucht die Klammer.
    const movedCount = await this.prisma.$transaction(async (tx) => {
      await tx.archivedChatMessage.createMany({
        data: candidates.map((c) => ({
          channel: c.channel,
          channelKey: c.channelKey,
          senderId: c.senderId,
          body: c.body,
          createdAt: c.createdAt,
          gameId: c.gameId,
        })),
      });
      const deleted = await tx.chatMessage.deleteMany({
        where: { id: { in: candidates.map((c) => c.id) } },
      });
      return deleted.count;
    });

    await this.audit.record({
      action: "chat.lobby.archived",
      meta: {
        archivedCount: movedCount,
        oldestArchived: oldest.toISOString(),
        newestArchived: newest.toISOString(),
        retentionHours: RETENTION_HOURS,
      },
    });
    this.log.log({ count: movedCount }, "Lobby-Chat-Nachrichten ins Archiv verschoben");
    return movedCount;
  }
}
