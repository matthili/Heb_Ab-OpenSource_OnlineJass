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
import { GameLockService } from "./game-lock.service.js";
import { GameService, type AnnouncementDecision, type PlayerView } from "./game.service.js";

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
    private readonly redis: RedisService,
    private readonly locks: GameLockService
  ) {
    // Defensive: alle DI-Params sollten von NestJS gefüllt sein. Wenn nicht,
    // ist das ein Setup-Problem (z.B. fehlende `reflect-metadata` /
    // `decoratorMetadata`-Transform in einer Test-Umgebung) — laut fehlt
    // statt erst beim ersten Method-Call mit verwirrendem TypeError.
    if (!games || !auth || !redis || !locks) {
      throw new Error(
        "GameGateway: Constructor-DI unvollständig. " +
          "Prüfe RedisModule/AuthModule-Imports und `emitDecoratorMetadata`."
      );
    }
  }

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
      // Beim allerersten Join (z.B. solo-vs-3-KI: Mensch joint, Tisch
      // ist gerade auf "announcing" mit einem KI-Announcer) muss die
      // KI-Loop angestoßen werden. Lock-geschützt, damit das nicht mit
      // parallelen `game:announce`-Events kollidiert.
      if (view.status === "announcing" && view.announcement?.iAmAnnouncer !== true) {
        await this.locks.withLock(gameId, async () => {
          await this.driveAIsLoop(gameId);
        });
      }
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
      // Single-Owner-Lock pro Game: User-Move + driveAIsLoop laufen als ein
      // atomarer Block. Parallel ankommende `game:move`-Events warten brav
      // in der Queue ab.
      await this.locks.withLock(gameId, async () => {
        const { view } = await this.games.playMoveAsUser(gameId, userId, {
          suit: card.suit as never,
          rank: card.rank as never,
        });
        await this.broadcastState(gameId);
        if (view.status === "finished") {
          this.server.to(roomKey(gameId)).emit("game:ended", { finalScore: view.finalScore });
          return;
        }
        await this.driveAIsLoop(gameId);
      });
    } catch (err) {
      this.fail(socket, this.errorMessage(err));
    }
  }

  /**
   * Trumpf-Ansage durch einen menschlichen Spieler (Sprint C).
   *
   * Payload:
   *   { gameId, decision: { kind: "push" } }
   *   { gameId, decision: { kind: "announce", mode, trumpSuit?, slalom? } }
   *
   * Server validiert + speichert die RoundDecision, broadcastet den neuen
   * State (= „playing"-Phase) und triggert ggf. die KI-Loop. Bei `push`
   * bleibt das Spiel im announcing-State, aber mit dem Partner als
   * Announcer — wenn der eine KI ist, springt die KI-Loop direkt in den
   * KI-Ansage-Schritt.
   */
  @SubscribeMessage("game:announce")
  async onAnnounce(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { gameId?: string; decision?: AnnouncementDecision }
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return this.fail(socket, "Not authenticated");
    const gameId = payload?.gameId;
    const decision = payload?.decision;
    if (typeof gameId !== "string" || !decision || !decision.kind) {
      return this.fail(socket, "gameId + decision { kind } required");
    }
    try {
      await this.locks.withLock(gameId, async () => {
        await this.games.applyAnnouncementAsUser(gameId, userId, decision);
        await this.broadcastState(gameId);
        // Nach einer erfolgreichen Ansage kann es sein, dass der Starter
        // direkt eine KI ist → KI-Loop dreht weiter. Nach einem `push`
        // wartet das Spiel auf den Partner — wenn der eine KI ist,
        // erledigt die Loop auch den Ansage-Schritt.
        await this.driveAIsLoop(gameId);
      });
    } catch (err) {
      this.fail(socket, this.errorMessage(err));
    }
  }

  /**
   * Stöck-Ansage durch einen menschlichen Spieler. Payload: `{ gameId }`.
   * Server prüft Eligibility (engine `announceStoeck` wirft `InvalidMoveError`
   * bei Missbrauch), broadcastet danach den neuen State.
   */
  @SubscribeMessage("game:announce-stoeck")
  async onAnnounceStoeck(
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
      await this.locks.withLock(gameId, async () => {
        await this.games.announceStoeckAsUser(gameId, userId);
        await this.broadcastState(gameId);
      });
    } catch (err) {
      this.fail(socket, this.errorMessage(err));
    }
  }

  /**
   * KI-Loop für **beide** Spielphasen:
   *
   *   - **announce**: wenn der aktuelle Announcer eine KI ist, lässt der
   *     Service die HeuristicPlayer-Entscheidung berechnen (push oder
   *     konkrete Ansage) und wendet sie an. Bei `push` wechselt der
   *     Announcer zum Partner; ist der auch eine KI, dreht die Loop
   *     direkt weiter. So endet eine reine KI-Tisch-Ansage immer in
   *     einer konkreten Variante.
   *   - **move**: wie bisher — KI wählt Karte, applyMove, broadcast.
   *
   * Sicherheitsnetz: maximal 36 Move-Schritte (= 4 × 9 Karten) plus
   * separater Counter für maximal 2 Ansage-Schritte (Original + ein
   * Push, danach muss Partner ansagen).
   */
  private async driveAIsLoop(gameId: string): Promise<void> {
    let announceSteps = 0;
    for (let i = 0; i < 40; i++) {
      const action = await this.games.nextAIAction(gameId);
      if (!action) return; // Mensch ist dran oder Spiel vorbei

      if (action.kind === "announce") {
        if (++announceSteps > 2) {
          this.log.error({ gameId, seat: action.seat }, "Ansage-Loop > 2 Schritte — fail-safe");
          return;
        }
        const decision = await this.games.aiChooseAnnouncement(gameId, action.seat);
        await this.games.applyAnnouncementAsSeat(gameId, action.seat, decision);
        await this.broadcastState(gameId);
        // Zwischen Ansage-Schritten kurz Pause, damit das Frontend die
        // Push-Animation zeigen kann.
        await sleep(aiStepDelayMs());
        continue;
      }

      // Move-Schritt.
      const card = await this.games.aiChooseMove(gameId, action.seat, action.aiSeatType);
      const { view } = await this.games.playMoveAsSeat(gameId, action.seat, card);
      await this.broadcastState(gameId);
      // Stöck-Auto-Ansage: wenn die KI gerade die zweite Trumpf-O/K
      // gespielt hat (= eligible), ruft sie sofort an. Heuristik: „immer".
      if (view.stoeckEligible) {
        await this.games.announceStoeckAsSeat(gameId, action.seat);
        await this.broadcastState(gameId);
      }
      if (view.status === "finished") {
        this.server.to(roomKey(gameId)).emit("game:ended", { finalScore: view.finalScore });
        return;
      }
      await sleep(aiStepDelayMs());
    }
    this.log.warn({ gameId }, "driveAIsLoop hat Sicherheitsgrenze erreicht");
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

/**
 * Pause zwischen zwei KI-Schritten. Bewusst lang gehalten (1,5 s), damit
 * der menschliche Spieler nach seinem eigenen Move die Karten der
 * KI-Gegner wirklich sehen kann — bei 200 ms hat die Loop alle drei
 * KI-Karten in einer halben Sekunde durchgerattert, der Mensch hat nichts
 * mitbekommen. Mit 1,5 s entsteht ein angenehmer „echter Spiel"-Rhythmus
 * (vergleichbar mit einem realen Jass-Tisch).
 *
 * **Override via env**: `AI_STEP_DELAY_MS=20` in den Integration-Tests
 * sorgt dafür, dass die WS-Test-Suite nicht in den 1,5-s-Sleep einläuft
 * (sonst Test-Timeout). In Production unbedingt unverändert lassen.
 *
 * Wir lesen den Wert **bei jedem Aufruf** — sonst friert ihn das Modul-
 * Caching schon beim Import ein, bevor der Test-Setup seinen Override
 * setzt.
 */
function aiStepDelayMs(): number {
  return Number(process.env["AI_STEP_DELAY_MS"] ?? "1500");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
