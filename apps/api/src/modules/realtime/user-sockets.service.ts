/**
 * Offene WebSocket-Verbindungen gezielt trennen — pro User oder pro Sitzung.
 *
 * Die WS-Authentifizierung prüft die Sitzung nur beim Verbindungsaufbau
 * (Auth-Middleware im `GameGateway`). Wird eine Sitzung beendet — Logout,
 * „Diese Sitzung abmelden", Passwort-Reset, Sperre, Konto-Löschung —, bliebe
 * ein bereits offener Socket sonst bis zum nächsten Verbindungsabbruch nutzbar
 * (Spieltisch, Chat). Nach dem Trennen scheitert jeder neue Verbindungsversuch
 * an der Auth-Middleware, weil die Sitzung weg ist.
 *
 * **Einbahn-Bindung** wie bei `DisconnectVoteService`/`SeatSwapService`: Das
 * `GameGateway` reicht den Socket.IO-Server in `afterInit` per `bindServer()`
 * herein; dieser Dienst importiert kein Gateway (kein ESM-Ladezyklus). Jeder
 * Socket kommt beim Verbinden in einen Raum pro User und einen pro Sitzung —
 * unabhängig von den Räumen der Lobby. Mit dem Redis-Adapter wirkt
 * `disconnectSockets` auch instanzübergreifend.
 */
import { Injectable, Logger } from "@nestjs/common";
import type { Server, Socket } from "socket.io";

export const userSocketsRoom = (userId: string): string => `user-sockets:${userId}`;
export const sessionSocketsRoom = (sessionId: string): string => `session-sockets:${sessionId}`;

/** Auswahl von Sockets (`server.in(…)`, ggf. mit `.except(…)`). */
type SocketSelection = ReturnType<Server["in"]>;

@Injectable()
export class UserSocketsService {
  private readonly log = new Logger(UserSocketsService.name);
  private server: Server | null = null;

  /** Vom `GameGateway` in `afterInit` aufgerufen (genau ein gemeinsamer Server, Pfad `/ws`). */
  bindServer(server: Server): void {
    this.server = server;
    // Die Auth-Middleware läuft VOR dem `connection`-Event → userId/sessionId sind gesetzt.
    server.on("connection", (socket: Socket) => {
      const { userId, sessionId } = (socket.data ?? {}) as {
        userId?: unknown;
        sessionId?: unknown;
      };
      if (typeof userId === "string") void socket.join(userSocketsRoom(userId));
      if (typeof sessionId === "string") void socket.join(sessionSocketsRoom(sessionId));
    });
  }

  /** Alle offenen Sockets des Users — alle Sitzungen, Geräte und Tabs. */
  disconnectUser(userId: string): void {
    this.disconnect((s) => s.in(userSocketsRoom(userId)), { userId });
  }

  /** Nur die Sockets EINER Sitzung (Logout, „Diese Sitzung abmelden", abgelaufene Sitzung). */
  disconnectSession(sessionId: string): void {
    this.disconnect((s) => s.in(sessionSocketsRoom(sessionId)), { sessionId });
  }

  /** Alle Sockets des Users außer denen der behaltenen Sitzung („Alle anderen abmelden"). */
  disconnectUserExcept(userId: string, keepSessionId: string): void {
    this.disconnect(
      (s) => s.in(userSocketsRoom(userId)).except(sessionSocketsRoom(keepSessionId)),
      { userId, keepSessionId }
    );
  }

  private disconnect(
    target: (server: Server) => SocketSelection,
    ctx: Record<string, string>
  ): void {
    if (!this.server) {
      this.log.warn(ctx, "Sockets trennen ohne gebundenen WS-Server — nichts getrennt");
      return;
    }
    target(this.server).disconnectSockets(true);
  }
}
