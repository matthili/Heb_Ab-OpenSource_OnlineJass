/**
 * WebSocket-Gateway für Lobby + Re-Match-Live-Updates (M6-F).
 *
 * **Beziehung zu `GameGateway`**: Beide hängen am gleichen Socket.IO-Server
 * (Path `/ws`). NestJS-Gateways teilen sich denselben Server-Instance, also
 * gilt die `server.use(authenticate)`-Middleware aus dem GameGateway auch
 * für alle hier registrierten Events — `socket.data.userId` ist gesetzt,
 * wenn unsere Subscribe-Handler getriggert werden.
 *
 * **Rooms**:
 *   - `lobby:list` — alle Clients, die die Lobby-Übersicht beobachten.
 *     Bekommen ein leichtgewichtiges `lobby:tables-updated`-Signal; das
 *     UI refetched die Liste.
 *   - `lobby:table:<id>` — alle Clients, die einen konkreten Tisch
 *     beobachten (auch ohne dort zu sitzen — z.B. Beitritts-Anfrager).
 *     Bekommen `lobby:table-state` mit dem aktuellen `TableDetailView`.
 *   - `lobby:user:<id>` — persönlicher Kanal pro User. Auto-Join bei
 *     Connection. Bekommt Events wie `lobby:invite-received`,
 *     `lobby:request-decided`, `lobby:owner-changed`.
 *
 * **Wer pusht**: Der `LobbyService` injiziert dieses Gateway und ruft die
 * öffentlichen Methoden (broadcast*, pushTo*) nach jeder State-Mutation.
 */
import { Injectable } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

interface AuthSocketData {
  userId?: string;
}

interface AuthenticatedSocket extends Socket {
  data: AuthSocketData;
}

const LIST_ROOM = "lobby:list";
const tableRoom = (tableId: string): string => `lobby:table:${tableId}`;
const userRoom = (userId: string): string => `lobby:user:${userId}`;

@Injectable()
@WebSocketGateway({
  path: "/ws",
  cors: { origin: true, credentials: true },
})
export class LobbyGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  /**
   * Beim Verbinden joint der Socket automatisch dem persönlichen Kanal
   * `lobby:user:<id>`, sodass Pushes wie eingehende Invites oder
   * Owner-Change-Notifikationen an alle Geräte/Tabs des Users ankommen.
   *
   * `afterInit` läuft pro Gateway einmal nach Server-Konstruktion. Das
   * `GameGateway` registriert seine Auth-Middleware (`server.use`) in
   * seinem eigenen `afterInit`. Da beide den gleichen Socket.IO-Server
   * benutzen und Middleware **VOR** dem `connection`-Event läuft, ist
   * `socket.data.userId` gesetzt, wenn unser Listener feuert — unabhängig
   * von der Reihenfolge der `afterInit`-Aufrufe (Middleware kommt früh
   * genug).
   */
  afterInit(server: Server): void {
    server.on("connection", (socket: AuthenticatedSocket) => {
      const userId = socket.data.userId;
      if (userId) {
        void socket.join(userRoom(userId));
      }
    });
  }

  // ─── Subscriptions ─────────────────────────────────────────────────

  @SubscribeMessage("lobby:subscribe-list")
  async onSubscribeList(@ConnectedSocket() socket: AuthenticatedSocket): Promise<{ ok: true }> {
    await socket.join(LIST_ROOM);
    return { ok: true };
  }

  @SubscribeMessage("lobby:unsubscribe-list")
  async onUnsubscribeList(@ConnectedSocket() socket: AuthenticatedSocket): Promise<{ ok: true }> {
    await socket.leave(LIST_ROOM);
    return { ok: true };
  }

  @SubscribeMessage("lobby:subscribe-table")
  async onSubscribeTable(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { tableId?: string }
  ): Promise<{ ok: true } | { error: string }> {
    const tableId = payload?.tableId;
    if (typeof tableId !== "string" || tableId.length === 0) {
      return { error: "tableId required" };
    }
    await socket.join(tableRoom(tableId));
    return { ok: true };
  }

  @SubscribeMessage("lobby:unsubscribe-table")
  async onUnsubscribeTable(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { tableId?: string }
  ): Promise<{ ok: true } | { error: string }> {
    const tableId = payload?.tableId;
    if (typeof tableId !== "string" || tableId.length === 0) {
      return { error: "tableId required" };
    }
    await socket.leave(tableRoom(tableId));
    return { ok: true };
  }

  // ─── Push-API (vom LobbyService aufgerufen) ────────────────────────

  /**
   * Signalisiert Abonnenten der Lobby-Liste, dass sich etwas geändert hat
   * (neuer Tisch, Tisch geschlossen, Status-Update). Payload bewusst
   * minimal — die UI refetched die Liste über REST.
   */
  broadcastLobbyListUpdate(reason: string, tableId?: string): void {
    this.server
      .to(LIST_ROOM)
      .emit("lobby:tables-updated", { reason, ...(tableId ? { tableId } : {}) });
  }

  /**
   * Pusht den aktuellen Tisch-State an alle Tisch-Abonnenten. Server
   * liefert die volle DetailView mit, damit der Client nicht refetchen muss.
   * Wir packen den Payload als `unknown`, weil der DetailView-Typ in
   * `lobby.service.ts` definiert ist und wir hier keine zyklische
   * Type-Abhängigkeit wollen.
   */
  broadcastTableState(tableId: string, view: unknown): void {
    this.server.to(tableRoom(tableId)).emit("lobby:table-state", view);
  }

  /** Tisch-Schließung — Abonnenten sollen das Subscription beenden. */
  broadcastTableClosed(tableId: string): void {
    this.server.to(tableRoom(tableId)).emit("lobby:table-closed", { tableId });
  }

  /**
   * Einzelner User-Push: Invite-Erhalt, Request-Entscheidung,
   * Owner-Change-Notifikation, etc. Garantiert reach auf alle offenen
   * Tabs/Geräte des Users.
   */
  pushToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  /**
   * Re-Match-Vote-Update: jeder Tisch-Abonnent erfährt den aktuellen Stand
   * (wer hat gevotet, wie viele fehlen). Outcome (`rematch-started` /
   * `back-to-waiting`) kommt als separates Event.
   */
  broadcastRematchVoteCast(
    tableId: string,
    payload: { gameId: string; userId: string; vote: "YES" | "NO"; remainingVotes: number }
  ): void {
    this.server.to(tableRoom(tableId)).emit("game:rematch-vote-cast", payload);
  }

  broadcastRematchDecided(
    tableId: string,
    payload:
      | { kind: "rematch-started"; gameId: string; starter: number }
      | { kind: "back-to-waiting"; removedUserIds: string[] }
  ): void {
    this.server.to(tableRoom(tableId)).emit("game:rematch-decided", payload);
  }
}
