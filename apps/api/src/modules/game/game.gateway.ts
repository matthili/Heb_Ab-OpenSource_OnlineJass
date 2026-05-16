/**
 * Socket.IO-Gateway für das Live-Spiel.
 *
 * Events
 *  Client → Server
 *    `game:join`  { gameId }                  → Server hängt den Socket in den Room
 *                                                 `game:<id>` und schickt initialen
 *                                                 `game:state` zurück.
 *    `game:move`  { gameId, card }            → Server validiert + applyMove und
 *                                                 broadcastet danach `game:state` an
 *                                                 alle Sockets im Room, **pro Socket
 *                                                 individuell gefiltert** (jeder
 *                                                 sieht nur seine eigene Hand).
 *  Server → Client
 *    `game:state` PlayerView                  → vollständiger per-Sitz-State
 *    `game:ended` { finalScore }              → Game-Ende-Marker
 *    `game:error` { message }                 → Validation/Auth-Fehler
 *
 * Auth-Handshake
 *   Bei jedem Connect wird das Cookie aus `socket.handshake.headers.cookie` an
 *   Better Auth (`auth.api.getSession`) weitergereicht. Schlägt die Session-
 *   Validierung fehl, disconnecten wir den Socket sofort.
 *
 * Multi-Instance
 *   Redis-Adapter ist verkabelt (siehe `bootstrapAdapter`); im Single-Instance-
 *   Dev-Setup macht er nichts Sichtbares, aber für M11/Helm ist er bereit.
 */
import { Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Server, Socket } from "socket.io";

import { AuthService } from "../auth/auth.service.js";
import { RedisService } from "../redis/redis.service.js";
import { GameService, type PlayerView } from "./game.service.js";

interface SocketData {
  userId?: string;
  userName?: string;
}

interface AuthenticatedSocket extends Socket {
  data: SocketData;
}

@WebSocketGateway({
  path: "/ws",
  cors: {
    origin: true,
    credentials: true,
  },
})
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly log = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: Server;

  // Duplizierte Redis-Clients für Pub/Sub — werden in afterInit verbunden
  // und in onModuleDestroy sauber geschlossen.
  private pub?: ReturnType<RedisService["duplicate"]>;
  private sub?: ReturnType<RedisService["duplicate"]>;

  constructor(
    private readonly games: GameService,
    private readonly auth: AuthService,
    private readonly redis: RedisService
  ) {}

  /**
   * Wird genau einmal nach `WebSocketServer`-Instanzierung aufgerufen.
   * Hier hängen wir die Auth-Middleware ein — sie läuft **vor** jedem
   * `connect`-Event, sodass `socket.data.userId` in allen Subscriber-Handlern
   * garantiert gesetzt ist.
   */
  afterInit(server: Server): void {
    // Redis-Adapter für Multi-Instance-Broadcast.
    this.pub = this.redis.duplicate();
    this.sub = this.redis.duplicate();
    server.adapter(createAdapter(this.pub, this.sub));
    this.log.log("Socket.IO Redis-Adapter aktiv");

    // Auth-Middleware: rejected nicht-eingeloggte Verbindungen, bevor
    // `connect` an die Clients gefeuert wird.
    server.use(async (socket, next) => {
      const userId = await this.authenticate(socket);
      if (!userId) {
        next(new Error("Not authenticated"));
        return;
      }
      socket.data.userId = userId;
      next();
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.pub?.quit(), this.sub?.quit()]);
  }

  // ─── Connection lifecycle ─────────────────────────────────────────

  handleConnection(socket: AuthenticatedSocket): void {
    this.log.debug({ socketId: socket.id, userId: socket.data.userId }, "WS connected");
  }

  handleDisconnect(socket: AuthenticatedSocket): void {
    this.log.debug({ socketId: socket.id, userId: socket.data.userId }, "WS disconnected");
  }

  // ─── Game events ──────────────────────────────────────────────────

  @SubscribeMessage("game:join")
  async onJoin(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { gameId?: string }
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return this.fail(socket, "Not authenticated");
    const gameId = payload?.gameId;
    if (typeof gameId !== "string" || gameId.length === 0) {
      return this.fail(socket, "gameId required");
    }
    try {
      const view = await this.games.viewForUser(gameId, userId);
      await socket.join(roomKey(gameId));
      socket.emit("game:state", view);
    } catch (err) {
      this.fail(socket, this.errorMessage(err));
    }
  }

  @SubscribeMessage("game:move")
  async onMove(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { gameId?: string; card?: { suit: string; rank: string } }
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return this.fail(socket, "Not authenticated");
    const gameId = payload?.gameId;
    const card = payload?.card;
    if (typeof gameId !== "string" || !card || typeof card.suit !== "string") {
      return this.fail(socket, "gameId + card { suit, rank } required");
    }
    try {
      const { view } = await this.games.playMoveAsUser(gameId, userId, {
        suit: card.suit as never,
        rank: card.rank as never,
      });
      await this.broadcastState(gameId);
      if (view.status === "finished") {
        this.server.to(roomKey(gameId)).emit("game:ended", { finalScore: view.finalScore });
      }
    } catch (err) {
      this.fail(socket, this.errorMessage(err));
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Pusht an jeden Socket im Game-Room dessen **eigene** Sicht. Spieler dürfen
   * sich nicht gegenseitig in die Hand schauen — das ist der einzige Punkt,
   * an dem Server-State an Clients geht.
   */
  private async broadcastState(gameId: string): Promise<void> {
    const sockets = (await this.server.in(roomKey(gameId)).fetchSockets()) as unknown as Array<{
      data: SocketData;
      emit(event: string, payload: unknown): boolean;
    }>;
    for (const sock of sockets) {
      const userId = sock.data.userId;
      if (!userId) continue;
      try {
        const view: PlayerView = await this.games.viewForUser(gameId, userId);
        sock.emit("game:state", view);
      } catch (err) {
        sock.emit("game:error", { message: this.errorMessage(err) });
      }
    }
  }

  private async authenticate(socket: Socket): Promise<string | null> {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) return null;
    try {
      const headers = new Headers();
      headers.set("cookie", cookieHeader);
      const result = (await this.auth.auth.api.getSession({ headers })) as {
        session?: { userId: string };
        user?: { id: string };
      } | null;
      if (result?.user?.id) return result.user.id;
      return null;
    } catch (err) {
      this.log.warn({ err }, "Session-Lookup im WS-Handshake fehlgeschlagen");
      return null;
    }
  }

  private fail(socket: AuthenticatedSocket, message: string): void {
    socket.emit("game:error", { message });
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}

function roomKey(gameId: string): string {
  return `game:${gameId}`;
}
