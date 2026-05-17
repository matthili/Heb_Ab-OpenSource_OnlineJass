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
 * **Channel-Access**: wir prüfen die Mitgliedschaft im REST-Sende-Pfad
 * (`ChatService.send`). Beim WS-Subscribe akzeptieren wir alle gültigen
 * Channel-Keys — wer nicht Mitglied ist, hört zwar mit, kann aber nichts
 * senden. Für M8-Scope ist das akzeptabel; striktes Auth-Subscribe
 * (Server prüft Membership beim subscribe) kommt mit M11.
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

import type { ChatMessageView } from "./chat.service.js";

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

  @SubscribeMessage("chat:subscribe")
  async onSubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { channelKey?: string }
  ): Promise<{ ok: true } | { error: string }> {
    if (!socket.data.userId) return { error: "Not authenticated" };
    const key = payload?.channelKey;
    if (typeof key !== "string" || key.length === 0) return { error: "channelKey required" };
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
}
