/**
 * Offene WebSocket-Verbindungen eines Users gezielt trennen.
 *
 * Die WS-Authentifizierung prüft die Sitzung nur beim Verbindungsaufbau
 * (Auth-Middleware im `GameGateway`). Werden Sitzungen widerrufen — etwa beim
 * Passwort-Reset —, bliebe ein bereits offener Socket sonst bis zum nächsten
 * Verbindungsabbruch nutzbar (Spieltisch, Chat). Nach dem Trennen scheitert
 * jeder neue Verbindungsversuch an der Auth-Middleware, weil die Sitzung weg ist.
 *
 * **Einbahn-Bindung** wie bei `DisconnectVoteService`/`SeatSwapService`: Das
 * `GameGateway` reicht den Socket.IO-Server in `afterInit` per `bindServer()`
 * herein; dieser Dienst importiert kein Gateway (kein ESM-Ladezyklus). Jeder
 * Socket kommt beim Verbinden in einen eigenen Raum pro User — unabhängig von
 * den Räumen der Lobby. Mit dem Redis-Adapter wirkt `disconnectSockets` auch
 * instanzübergreifend.
 */
import { Injectable, Logger } from "@nestjs/common";
import type { Server, Socket } from "socket.io";

export const userSocketsRoom = (userId: string): string => `user-sockets:${userId}`;

@Injectable()
export class UserSocketsService {
  private readonly log = new Logger(UserSocketsService.name);
  private server: Server | null = null;

  /** Vom `GameGateway` in `afterInit` aufgerufen (genau ein gemeinsamer Server, Pfad `/ws`). */
  bindServer(server: Server): void {
    this.server = server;
    // Die Auth-Middleware läuft VOR dem `connection`-Event → `userId` ist gesetzt.
    server.on("connection", (socket: Socket) => {
      const userId: unknown = socket.data?.userId;
      if (typeof userId === "string") void socket.join(userSocketsRoom(userId));
    });
  }

  /** Trennt alle offenen Sockets des Users — alle Geräte und Tabs. */
  disconnectUser(userId: string): void {
    if (!this.server) {
      this.log.warn({ userId }, "disconnectUser ohne gebundenen WS-Server — nichts getrennt");
      return;
    }
    this.server.in(userSocketsRoom(userId)).disconnectSockets(true);
  }
}
