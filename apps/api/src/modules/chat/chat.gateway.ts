/**
 * WS-Gateway für Chat-Nachrichten.
 *
 * **Subscriptions** (Room-Pattern, analog zu LobbyGateway):
 *   - `chat:subscribe` mit `{channelKey}` → joint Socket-Room
 *     `chat:<channelKey>`.
 *   - `chat:unsubscribe` mit `{channelKey}` → leavt Room.
 *
 * **Broadcast**: vom `ChatController` nach einem erfolgreichen
 * `send()` → `gateway.broadcastMessage(view)` → alle Subscriber im
 * Channel-Room bekommen `chat:message`.
 *
 * Auth-Middleware wird vom GameGateway global gesetzt (`server.use`) —
 * dadurch ist `socket.data.userId` auch hier garantiert verfügbar.
 *
 * **Channel-Access**: Sowohl der REST-Sende-Pfad (`ChatService.send`) als
 * auch der WS-`chat:subscribe`-Handler prüfen die Mitgliedschaft über
 * `ChatService.assertCanAccessChannel` (LOBBY frei, GAME nur Tisch-Sitze,
 * DM nur die zwei Beteiligten). Wer nicht Mitglied ist, kann den Channel
 * weder abonnieren noch mithören.
 */
import { Injectable } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import { ChatService, type ChatMessageView } from "./chat.service.js";

interface AuthSocketData {
  userId?: string;
}

interface AuthenticatedSocket extends Socket {
  data: AuthSocketData;
}

const channelRoom = (channelKey: string): string => `chat:${channelKey}`;

@Injectable()
@WebSocketGateway({
  path: "/ws",
  cors: { origin: true, credentials: true },
})
export class ChatGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly chat: ChatService) {}

  @SubscribeMessage("chat:subscribe")
  async onSubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { channelKey?: string }
  ): Promise<{ ok: true } | { error: string }> {
    const userId = socket.data.userId;
    if (!userId) return { error: "Not authenticated" };
    const key = payload?.channelKey;
    if (typeof key !== "string" || key.length === 0) return { error: "channelKey required" };
    // Mitgliedschaft prüfen — sonst könnte ein Nicht-Mitglied einen fremden
    // Game-Chat oder ein privates DM mithören.
    try {
      await this.chat.assertCanAccessChannel(userId, key);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Zugriff verweigert" };
    }
    await socket.join(channelRoom(key));
    return { ok: true };
  }

  @SubscribeMessage("chat:unsubscribe")
  async onUnsubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { channelKey?: string }
  ): Promise<{ ok: true } | { error: string }> {
    const key = payload?.channelKey;
    if (typeof key !== "string" || key.length === 0) return { error: "channelKey required" };
    await socket.leave(channelRoom(key));
    return { ok: true };
  }

  /** Wird vom ChatController nach erfolgreichem Send aufgerufen. */
  broadcastMessage(view: ChatMessageView): void {
    this.server.to(channelRoom(view.channelKey)).emit("chat:message", view);
  }

  /**
   * **System-Nachricht** an einen Channel. Ephemer — keine DB-Persistenz,
   * nur Live-Broadcast. Wird z.B. vom DisconnectVoteService genutzt, um
   * KI-Stimmen und Phasen-Hinweise an den Game-Chat zu posten.
   *
   * Frontend erkennt System-Nachrichten daran, dass `senderId` leer ist
   * und `system: true` gesetzt — Rendering: ausgegrautes Italic.
   */
  broadcastSystemMessage(channelKey: string, body: string): void {
    const view = {
      id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channel: channelKey.startsWith("game:") ? ("GAME" as const) : ("LOBBY" as const),
      channelKey,
      senderId: "",
      senderName: "System",
      body,
      createdAt: new Date().toISOString(),
      system: true as const,
    };
    this.server.to(channelRoom(channelKey)).emit("chat:message", view);
  }
}
