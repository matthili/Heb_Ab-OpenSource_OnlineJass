/**
 * Chat-Service: Versand + Historie für die drei Kanäle (LOBBY / GAME / DM).
 *
 * **Channel-Access-Regeln**:
 *   - LOBBY (`lobby:global`): jeder eingeloggte User darf schreiben/lesen.
 *   - GAME (`game:<id>`): nur Mitspieler am Tisch (Sitz mit `userId`).
 *   - DM (`dm:<a>:<b>`): nur die zwei beteiligten User. Reihenfolge der
 *     IDs ist im Key alphabetisch — der Service prüft die Mitgliedschaft
 *     unabhängig davon, welche Position der Caller im Key hat.
 *
 * **Rate-Limit**: 10 Nachrichten / 30 s pro User pro Kanal, in Redis
 * gehalten (Key `chat:rate:<userId>:<channelKey>`, INCR + EXPIRE). Wirft
 * `ThrottlerException` bei Überschreitung.
 *
 * **Persistenz**:
 *   - GAME-/DM-Messages werden direkt in `ChatMessage` geschrieben.
 *     LOBBY-Messages auch — der 12-h-Cleanup-Cron (M8-C) räumt sie
 *     später ins Audit-Log.
 *   - `body` ist server-sanitized HTML (siehe chat.sanitize.ts). Wir
 *     speichern bewusst HTML, nicht Roh-Markdown: 1× sanitize beim
 *     Schreiben, beliebig oft lesen ohne erneute Konvertierung.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ChatChannel } from "@prisma/client";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { sanitizeChatMarkdown } from "./chat.sanitize.js";

const RATE_WINDOW_SECONDS = 30;
const RATE_MAX_MESSAGES = 10;

export interface ChatMessageView {
  id: string; // BigInt → String fürs JSON
  channel: ChatChannel;
  channelKey: string;
  senderId: string;
  senderName: string;
  body: string; // sanitized HTML
  createdAt: string; // ISO
}

@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService
  ) {}

  /**
   * Nachricht senden. Validiert Channel-Zugehörigkeit, rate-limited,
   * sanitized, persistiert. Returnt die View — die der Gateway-Layer an
   * alle Kanal-Subscriber broadcastet.
   */
  async send(senderId: string, channelKey: string, rawBody: string): Promise<ChatMessageView> {
    const channel = this.classifyChannel(channelKey);
    await this.requireMembership(senderId, channel, channelKey);
    await this.enforceRateLimit(senderId, channelKey);

    const sanitized = sanitizeChatMarkdown(rawBody);
    if (sanitized.length === 0) {
      throw new BadRequestException("Nachricht ist nach Sanitization leer.");
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { name: true },
    });
    if (!sender) throw new NotFoundException(`User ${senderId} nicht gefunden`);

    // Bei GAME-Channel hängen wir die gameId mit dran — für Replay-/
    // Profil-History-Joins (Plan-Doc §4).
    const gameId = channel === ChatChannel.GAME ? this.extractGameId(channelKey) : null;

    const row = await this.prisma.chatMessage.create({
      data: {
        channel,
        channelKey,
        senderId,
        body: sanitized,
        ...(gameId ? { gameId } : {}),
      },
      select: { id: true, createdAt: true },
    });

    return {
      id: row.id.toString(),
      channel,
      channelKey,
      senderId,
      senderName: sender.name,
      body: sanitized,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Historie für einen Kanal laden. Standard: 50 jüngste, absteigend
   * sortiert. Pagination via `before` (ISO-Timestamp) — Client lädt
   * ältere Nachrichten beim Hochscrollen nach.
   */
  async getHistory(
    callerId: string,
    channelKey: string,
    options: { limit: number; before?: string }
  ): Promise<ChatMessageView[]> {
    const channel = this.classifyChannel(channelKey);
    await this.requireMembership(callerId, channel, channelKey);

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        channelKey,
        ...(options.before ? { createdAt: { lt: new Date(options.before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit,
      include: { sender: { select: { id: true, name: true } } },
    });

    // Wir liefern älteste zuerst (chronologische Reihenfolge fürs
    // UI-Rendering); der DB-Sort ist desc für die `take`-Limit-Semantik.
    return rows.reverse().map((r) => ({
      id: r.id.toString(),
      channel: r.channel,
      channelKey: r.channelKey,
      senderId: r.senderId,
      senderName: r.sender.name,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Wirft, wenn der User den Channel nicht lesen/abonnieren darf. Nutzt
   * exakt dieselben Regeln wie `send`/`getHistory` (LOBBY frei, GAME nur
   * Tisch-Sitze, DM nur die zwei Beteiligten) — gedacht für den
   * WS-`chat:subscribe`-Guard, damit Nicht-Mitglieder nicht mithören.
   */
  async assertCanAccessChannel(userId: string, channelKey: string): Promise<void> {
    const channel = this.classifyChannel(channelKey);
    await this.requireMembership(userId, channel, channelKey);
  }

  // ─── Channel-Klassifikation + Access-Control ───────────────────────

  private classifyChannel(channelKey: string): ChatChannel {
    if (channelKey === "lobby:global") return ChatChannel.LOBBY;
    if (channelKey.startsWith("game:")) return ChatChannel.GAME;
    if (channelKey.startsWith("dm:")) return ChatChannel.DM;
    throw new BadRequestException(`Unbekannter channelKey: ${channelKey}`);
  }

  private async requireMembership(
    userId: string,
    channel: ChatChannel,
    channelKey: string
  ): Promise<void> {
    if (channel === ChatChannel.LOBBY) return; // alle eingeloggten User
    if (channel === ChatChannel.GAME) {
      const gameId = this.extractGameId(channelKey);
      const seat = await this.prisma.gameSeat.findFirst({
        where: { gameId, userId },
        select: { seat: true },
      });
      if (!seat) {
        throw new ForbiddenException("Du sitzt nicht an diesem Spiel.");
      }
      return;
    }
    if (channel === ChatChannel.DM) {
      const parts = channelKey.split(":");
      if (parts.length !== 3) {
        throw new BadRequestException(`Ungültiger DM-Channel-Key: ${channelKey}`);
      }
      const [, a, b] = parts as [string, string, string];
      if (userId !== a && userId !== b) {
        throw new ForbiddenException("Du bist nicht Teil dieses DMs.");
      }
      return;
    }
  }

  private extractGameId(channelKey: string): string {
    const id = channelKey.slice("game:".length);
    if (!id) throw new BadRequestException(`Ungültiger Game-Channel-Key: ${channelKey}`);
    return id;
  }

  // ─── Rate-Limit ────────────────────────────────────────────────────

  private async enforceRateLimit(userId: string, channelKey: string): Promise<void> {
    const key = `chat:rate:${userId}:${channelKey}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, RATE_WINDOW_SECONDS);
    }
    if (count > RATE_MAX_MESSAGES) {
      this.log.warn({ userId, channelKey, count }, "Chat-Rate-Limit überschritten");
      await this.audit.record({
        action: "chat.rate_limit",
        actorId: userId,
        target: channelKey,
        meta: { count, window: RATE_WINDOW_SECONDS },
      });
      throw new ConflictException(
        `Zu viele Nachrichten — max ${RATE_MAX_MESSAGES} pro ${RATE_WINDOW_SECONDS}s.`
      );
    }
  }
}
