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
import type { Announcement } from "@jass/engine";
import type { Server, Socket } from "socket.io";

import { AuditService } from "../audit/audit.service.js";
import { AuthService } from "../auth/auth.service.js";
import { ChatGateway } from "../chat/chat.gateway.js";
import { RedisService } from "../redis/redis.service.js";
import { BodenseeGameService, type BodenseePlayerView } from "./bodensee-game.service.js";
import { DisconnectVoteService } from "./disconnect-vote.service.js";
import { GameLockService } from "./game-lock.service.js";
import { GameService, type AnnouncementDecision, type PlayerView } from "./game.service.js";
import { PerUserSocketRegistry } from "./per-user-socket-registry.service.js";
import { SocketRateTracker } from "../../common/ws-rate-limit.js";
import type { VoteChoice } from "./disconnect-vote.js";

interface SocketData {
  userId?: string;
  userName?: string;
  /** Per-Socket Rate-Limit-Tracker (siehe `common/ws-rate-limit.ts`). */
  rateTracker?: SocketRateTracker;
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

  /**
   * Geplante Bodensee-Sitz-Ersetzungen, indiziert per `${gameId}:${userId}`.
   * Bei Disconnect wird ein Timer gestartet (Reconnect-Schonfrist), bei
   * Reconnect (handleConnection) wird der Timer wieder gecancelt — der
   * Sitz bleibt menschlich. Speicher ist in-memory bewusst: Bodensee hat
   * nur eine Process-Instance pro Tisch (Single-Owner-Lock); ein Crash
   * würde die Schonfrist aufheben, was die schlechteste Folge ist, mit der
   * man leben kann (KI übernimmt sofort statt erst in 30 s — derselbe
   * Endzustand). Kein Redis-State nötig.
   */
  private readonly pendingBodenseeReplacements = new Map<
    string,
    { timer: NodeJS.Timeout; gameId: string; userId: string }
  >();

  constructor(
    private readonly games: GameService,
    private readonly bodenseeGames: BodenseeGameService,
    private readonly auth: AuthService,
    private readonly redis: RedisService,
    private readonly locks: GameLockService,
    private readonly audit: AuditService,
    private readonly userRegistry: PerUserSocketRegistry,
    private readonly disconnectVote: DisconnectVoteService,
    private readonly chatGateway: ChatGateway
  ) {
    // Defensive: alle DI-Params sollten von NestJS gefüllt sein. Wenn nicht,
    // ist das ein Setup-Problem (z.B. fehlende `reflect-metadata` /
    // `decoratorMetadata`-Transform in einer Test-Umgebung) — laut fehlt
    // statt erst beim ersten Method-Call mit verwirrendem TypeError.
    if (
      !games ||
      !bodenseeGames ||
      !auth ||
      !redis ||
      !locks ||
      !audit ||
      !userRegistry ||
      !disconnectVote ||
      !chatGateway
    ) {
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

    // Disconnect-Vote-Service mit Server-Referenz + Outcome-Hooks
    // versorgen. Boot-Recovery läuft danach im Hintergrund.
    this.disconnectVote.setServer(server);
    void this.disconnectVote.setHooks({
      closeTable: async (gameId, reason) => {
        await this.handleDisconnectClose(gameId, reason);
      },
      replaceSeatWithAi: async (gameId, _seat, userId) => {
        await this.games.markUserLeft(gameId, userId);
        await this.games.driveAIsToEnd(gameId);
      },
      resumeGame: async (gameId) => {
        // Bei reinem Reconnect läuft das Game eh weiter — aber falls
        // gerade eine KI dran ist (z.B. Disconnect mitten im Trick),
        // muss der AI-Loop angestoßen werden.
        await this.driveAIsLoop(gameId);
      },
      postChatSystemMessage: (gameId, body) => {
        this.chatGateway.broadcastSystemMessage(`game:${gameId}`, body);
      },
    });
  }

  /** Wird vom Disconnect-Vote-Service aufgerufen, wenn der Tisch geschlossen
   *  werden muss (STOP-Outcome). Delegiert an `GameService.closeGameForDisconnect`
   *  (DB + Redis-Cleanup) und broadcastet `game:disconnect-closed` an alle
   *  Sockets im Room. Das Frontend zeigt dann das Result-Overlay mit OK-Button. */
  private async handleDisconnectClose(gameId: string, reason: string): Promise<void> {
    try {
      await this.games.closeGameForDisconnect(gameId, reason);
      this.server.to(roomKey(gameId)).emit("game:disconnect-closed", { reason });
    } catch (err) {
      this.log.error({ err, gameId }, "Tisch-Close nach Disconnect fehlgeschlagen");
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Ausstehende Bodensee-Grace-Timer abräumen, damit Vitest-Worker beim
    // App-Shutdown keinen Open-Handle hat.
    for (const entry of this.pendingBodenseeReplacements.values()) {
      clearTimeout(entry.timer);
    }
    this.pendingBodenseeReplacements.clear();
    await Promise.allSettled([this.pub?.quit(), this.sub?.quit()]);
  }

  // ─── Connection lifecycle ─────────────────────────────────────────

  handleConnection(socket: AuthenticatedSocket): void {
    this.log.debug({ socketId: socket.id, userId: socket.data.userId }, "WS connected");

    // ── SYNCHRONER Teil ZUERST: Middleware registrieren, bevor irgend
    //    ein Client-Frame eintreffen kann. Ein async/await hier oben
    //    wäre ein Race — Frames könnten den Tracker noch nicht sehen
    //    und die Middleware noch nicht registriert wäre.
    const tracker = new SocketRateTracker();
    socket.data.rateTracker = tracker;
    socket.use((packet, next) => {
      void this.runWsGuards(socket, packet, next);
    });

    // ── ASYNCHRONER Teil: Per-User-Socket-Limit in Redis tracken.
    //    Läuft im Hintergrund; falls Redis langsam ist, blockt das den
    //    Connect-Flow nicht — und der Tracker oben schützt sofort.
    const userId = socket.data.userId;
    if (userId) {
      void this.registerUserSocket(userId, socket).catch((err) => {
        this.log.warn({ err, userId }, "PerUserSocketRegistry.register fehlgeschlagen");
      });
    }
  }

  private async registerUserSocket(userId: string, socket: AuthenticatedSocket): Promise<void> {
    const { evictSocketIds } = await this.userRegistry.register(userId, socket.id);
    // Reconnect-Schonfrist für Bodensee: falls für diesen User ein Replacement-
    // Timer läuft (Disconnect lag weniger als BODENSEE_RECONNECT_GRACE_MS
    // zurück), abbrechen — der Spieler ist zurück.
    this.cancelBodenseeReplacementsForUser(userId);
    if (evictSocketIds.length > 0) {
      await this.evictOldSockets(userId, evictSocketIds);
    }
  }

  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    this.log.debug({ socketId: socket.id, userId: socket.data.userId }, "WS disconnected");
    const userId = socket.data.userId;
    if (!userId) return;
    try {
      await this.userRegistry.unregister(userId, socket.id);
      const remaining = await this.userRegistry.countSockets(userId);
      if (remaining === 0) {
        // User ist real offline — alle Tabs/Geräte weg.
        // Wenn er an einem laufenden Game sitzt, Disconnect-Flow triggern:
        // Kreuz/Solo via mehrstufigem Vote, Bodensee via KI-Übernahme.
        await this.triggerDisconnectVotesForUser(userId);
        await this.triggerBodenseeDisconnectForUser(userId);
      }
    } catch (err) {
      this.log.warn({ err, userId }, "Disconnect-Handling fehlgeschlagen");
    }
  }

  /**
   * Für jeden laufenden Game, in dem der User sitzt, den Disconnect-
   * Vote-Service informieren. Ein User kann theoretisch an mehreren
   * Tischen gleichzeitig sitzen (Schema erlaubt es), praktisch ist es
   * aber typischerweise einer.
   */
  private async triggerDisconnectVotesForUser(userId: string): Promise<void> {
    const gameIds = await this.games.getActiveGameIdsForUser(userId);
    for (const gameId of gameIds) {
      const seat = await this.games.findActiveSeatForUser(gameId, userId);
      if (seat === null) continue;
      const participants = await this.games.getDisconnectParticipants(gameId, [seat]);
      await this.disconnectVote.onSeatDisconnected(gameId, seat, userId, participants);
    }
  }

  /**
   * Disconnect-Handling für Bodensee-Tische. Bodensee ist 2-Spieler — ein
   * mehrstufiges Vote wie bei Kreuz ergäbe keinen Sinn. Stattdessen wird
   * der Sitz des getrennten Spielers sofort durch eine KI ersetzt, damit
   * das Spiel nicht hängenbleibt; die KI-Loop spielt weiter — bzw. das
   * Spiel zu Ende, falls dann beide Sitze KI sind.
   */
  private async triggerBodenseeDisconnectForUser(userId: string): Promise<void> {
    const gameIds = await this.bodenseeGames.getActiveGameIdsForUser(userId);
    const graceMs = this.bodenseeReconnectGraceMs();
    for (const gameId of gameIds) {
      const key = `${gameId}:${userId}`;
      // Doppel-Disconnect (sehr selten): das alte Grace-Fenster gilt weiter,
      // wir armen nichts neu — sonst würde Reconnect-Stalking die Grace endlos
      // verlängern können.
      if (this.pendingBodenseeReplacements.has(key)) continue;

      this.chatGateway.broadcastSystemMessage(
        roomKey(gameId),
        `Ein Spieler hat die Verbindung verloren. ` +
          `Kommt er nicht binnen ${Math.round(graceMs / 1000)} s zurück, übernimmt die KI.`
      );

      const timer = setTimeout(() => {
        void this.executeBodenseeReplacement(gameId, userId).catch((err) => {
          this.log.warn(
            { err, gameId, userId },
            "Bodensee-Grace-Replacement (Timer-Ablauf) fehlgeschlagen"
          );
        });
      }, graceMs);
      this.pendingBodenseeReplacements.set(key, { timer, gameId, userId });
    }
  }

  /**
   * Wird vom Grace-Timer aufgerufen, wenn der User nicht rechtzeitig zurück
   * ist. Genau die Logik, die früher direkt in `triggerBodenseeDisconnectForUser`
   * stand — der einzige Unterschied ist, dass jetzt eine Schonfrist davorliegt.
   */
  private async executeBodenseeReplacement(gameId: string, userId: string): Promise<void> {
    this.pendingBodenseeReplacements.delete(`${gameId}:${userId}`);
    try {
      await this.locks.withLock(gameId, async () => {
        const replaced = await this.bodenseeGames.replaceSeatWithAi(gameId, userId);
        if (!replaced) return;
        this.chatGateway.broadcastSystemMessage(
          roomKey(gameId),
          "Der Spieler ist nicht zurückgekehrt — die KI übernimmt seinen Platz."
        );
        await this.broadcastBodenseeState(gameId);
        await this.driveBodenseeAIsLoop(gameId);
      });
    } catch (err) {
      this.log.warn({ err, gameId, userId }, "Bodensee-Disconnect-Handling fehlgeschlagen");
    }
  }

  /**
   * Bricht alle ausstehenden Bodensee-Sitz-Ersetzungen für diesen User ab —
   * pro Spiel, in dem er offline gegangen war. Wird beim Reconnect aufgerufen
   * (jeder neue Socket des Users). Idempotent: ohne pending Einträge ein No-op.
   */
  private cancelBodenseeReplacementsForUser(userId: string): void {
    for (const [key, entry] of this.pendingBodenseeReplacements) {
      if (entry.userId !== userId) continue;
      clearTimeout(entry.timer);
      this.pendingBodenseeReplacements.delete(key);
      this.chatGateway.broadcastSystemMessage(
        roomKey(entry.gameId),
        "Der Spieler ist zurück — das Spiel läuft normal weiter."
      );
    }
  }

  /**
   * Bodensee-Reconnect-Schonfrist. Default 30 s in production; in Tests via
   * `DISCONNECT_PHASE_MS_SCALE` skaliert (gleiche Variable wie die Kreuz/Solo-
   * Disconnect-Vote-Phasen, um Test-Setups simpel zu halten).
   * `main.ts:assertNoUnsafeFlagsInProduction` blockt das Scale-Flag in prod.
   */
  private bodenseeReconnectGraceMs(): number {
    const base = 30_000;
    const scale = Number(process.env["DISCONNECT_PHASE_MS_SCALE"] ?? "1");
    const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return Math.max(100, Math.floor(base * factor));
  }

  /**
   * Middleware-Implementation für jedes eingehende WS-Frame.
   * Zwei Schichten:
   *   1. Per-Socket Sliding-Window (in-memory, schnell)
   *   2. Per-User Aggregat-Rate (Redis, deckt Multi-Tab/Multi-Browser)
   *
   * Verstöße in beiden Schichten verwerfen das Frame + informieren
   * den Client. Wiederholte Per-Socket-Verstöße eskalieren zum
   * Disconnect (siehe SocketRateTracker).
   */
  private async runWsGuards(
    socket: AuthenticatedSocket,
    packet: unknown[],
    next: (err?: Error) => void
  ): Promise<void> {
    const eventName = packet[0];
    if (typeof eventName !== "string") {
      next();
      return;
    }
    const tracker = socket.data.rateTracker;
    if (!tracker) {
      next();
      return;
    }
    // 1. Per-Socket-Check
    const result = tracker.check(eventName);
    if (!result.allow) {
      socket.emit("game:error", {
        message: `Rate-Limit erreicht für "${eventName}". Bitte langsamer.`,
      });
      if (result.disconnect) {
        void this.audit
          .record({
            action: "security.ws.disconnect.rate_limit",
            actorId: socket.data.userId ?? null,
            meta: { event: eventName, socketId: socket.id, reason: "per-socket" },
          })
          .catch(() => {
            /* audit darf den Disconnect nicht blockieren */
          });
        this.log.warn(
          { userId: socket.data.userId, socketId: socket.id, event: eventName },
          "WS-Rate-Limit (per-socket): Disconnect"
        );
        socket.disconnect(true);
      }
      return;
    }
    // 2. Per-User Aggregat-Check (deckt Multi-Tab-Bypass des Per-Socket-Limits)
    const userId = socket.data.userId;
    if (userId) {
      const ok = await this.userRegistry.checkRate(userId);
      if (!ok) {
        socket.emit("game:error", {
          message: "Globales Rate-Limit erreicht (zu viele Aktionen über alle deine Tabs).",
        });
        void this.audit
          .record({
            action: "security.ws.user_rate_limit",
            actorId: userId,
            meta: { event: eventName, socketId: socket.id },
          })
          .catch(() => {
            /* swallow */
          });
        return;
      }
    }
    next();
  }

  /**
   * Disconnectet alte Sockets eines Users (wenn das Per-User-Limit
   * gerissen wurde). Schickt vorher noch eine Notification, damit der
   * UI die Ursache anzeigen kann („Du wurdest von einer neueren Sitzung
   * abgemeldet").
   */
  private async evictOldSockets(userId: string, socketIds: string[]): Promise<void> {
    const ns = this.server.sockets;
    for (const sid of socketIds) {
      const old = ns.sockets.get(sid);
      if (!old) continue;
      try {
        old.emit("auth:session-superseded", {
          message:
            "Du hast eine neue Sitzung in einem anderen Tab/Gerät geöffnet. " +
            "Diese Verbindung wird daher geschlossen.",
        });
        old.disconnect(true);
      } catch {
        // ignore
      }
    }
    void this.audit
      .record({
        action: "security.ws.evict_old_socket",
        actorId: userId,
        meta: { evictedSocketIds: socketIds },
      })
      .catch(() => {
        /* swallow */
      });
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

      // Disconnect-Reconnect: User war evtl. in einer Disconnect-Phase
      // (siehe DisconnectVoteService). Sobald sein erstes WS-Connect
      // wieder steht UND er ein Game gejoint hat, ist er „zurück" —
      // Vote-Service räumt seinen Sitz aus den disconnectedSeats.
      void this.disconnectVote.onSeatReconnected(gameId, userId).catch((err) => {
        this.log.warn({ err, gameId, userId }, "DisconnectVote.onSeatReconnected fehlgeschlagen");
      });

      // Initial-State des Disconnect-Overlay an den neuen Socket
      // pushen — wenn er mitten in der Vote-Phase reinkommt, soll er
      // direkt das Overlay sehen.
      const disconnectState = await this.disconnectVote.getState(gameId);
      if (disconnectState) {
        socket.emit("game:disconnect-state", disconnectState);
      }

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

  /**
   * Vote-Endpoint für Disconnect-Abstimmung.
   * Payload: `{ gameId, choice: "STOP" | "WAIT" | "FILL" }`.
   * Validation läuft im `DisconnectVoteService.castVote` (Phase, Sitz,
   * Einstimmigkeit etc.). Fehler werden als `game:error` zurückgegeben.
   */
  @SubscribeMessage("game:disconnect-vote")
  async onDisconnectVote(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { gameId?: string; choice?: string }
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return this.fail(socket, "Not authenticated");
    const gameId = payload?.gameId;
    const choice = payload?.choice;
    if (typeof gameId !== "string" || !choice) {
      return this.fail(socket, "gameId + choice required");
    }
    if (choice !== "STOP" && choice !== "WAIT" && choice !== "FILL") {
      return this.fail(socket, `Invalid vote choice: ${choice}`);
    }
    try {
      const seat = await this.games.findActiveSeatForUser(gameId, userId);
      if (seat === null) {
        return this.fail(socket, "Du sitzt nicht aktiv an diesem Tisch.");
      }
      await this.disconnectVote.castVote(gameId, userId, seat, choice as VoteChoice);
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
   * Abheben durch einen menschlichen Abheber. Payload:
   * `{ gameId, cutIndex }` — cutIndex 1..35 = abheben, 0 = klopfen.
   * Server prüft, dass der Sender wirklich der Abheber ist.
   */
  @SubscribeMessage("game:cut")
  async onCut(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { gameId?: string; cutIndex?: number }
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return this.fail(socket, "Not authenticated");
    const gameId = payload?.gameId;
    const cutIndex = payload?.cutIndex;
    if (typeof gameId !== "string" || typeof cutIndex !== "number") {
      return this.fail(socket, "gameId + cutIndex required");
    }
    try {
      await this.locks.withLock(gameId, async () => {
        await this.games.applyCutAsUser(gameId, userId, cutIndex);
        await this.broadcastState(gameId);
        // Nach dem Abheben ist evtl. direkt eine KI als Ansager dran.
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
   * Weisen-Button geklickt: öffnet die Karten-Selection für diesen Sitz.
   * Payload: `{ gameId }`.
   */
  @SubscribeMessage("game:weisen-click")
  async onWeisenClick(
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
        await this.games.clickWeisenAsUser(gameId, userId);
        await this.broadcastState(gameId);
      });
    } catch (err) {
      this.fail(socket, this.errorMessage(err));
    }
  }

  /**
   * Weisen-Submit: Karten in Gruppen pro Weis. Beispiel:
   *   `[ [{suit:'EICHEL',rank:'UNTER'},…vier Buur…],
   *      [{suit:'HERZ',rank:'SECHS'},…3-Blatt…] ]`
   * Server validiert jede Gruppe + Disjunktheit der Karten.
   */
  @SubscribeMessage("game:weisen-submit")
  async onWeisenSubmit(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody()
    payload: {
      gameId?: string;
      groups?: Array<Array<{ suit: string; rank: string }>>;
    }
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return this.fail(socket, "Not authenticated");
    const gameId = payload?.gameId;
    const groups = payload?.groups;
    if (typeof gameId !== "string" || !Array.isArray(groups)) {
      return this.fail(socket, "gameId + groups required");
    }
    try {
      await this.locks.withLock(gameId, async () => {
        // Casts auf Card[] — Validierung im Service übernimmt das Zod-Äquivalent.
        const typed = groups.map(
          (g) =>
            g.map((c) => ({ suit: c.suit, rank: c.rank })) as Array<{ suit: string; rank: string }>
        ) as never;
        await this.games.submitWeisenAsUser(gameId, userId, typed);
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
    try {
      for (let i = 0; i < 40; i++) {
        const action = await this.games.nextAIAction(gameId);
        if (!action) return; // Mensch ist dran oder Spiel vorbei

        if (action.kind === "cut") {
          // KI-Abheber hebt an einer zufälligen Stelle ab (1..35).
          const cutIndex = 1 + Math.floor(Math.random() * 35);
          await this.games.applyCutAsSeat(gameId, action.seat, cutIndex);
          await this.broadcastState(gameId);
          await sleep(aiStepDelayMs());
          continue;
        }

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

        // Weisen-Auto-Vor-Move: bevor die KI ihre erste Karte in Trick 1
        // spielt, soll sie deklarieren (= Button klicken + Karten submitten).
        // Die Engine prüft via `weisenWindowOpen`, ob das Fenster noch
        // offen ist; bei jedem späteren Aufruf ist es ein No-op.
        await this.games.aiAutoWeisenForSeat(gameId, action.seat);
        await this.broadcastState(gameId);

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
    } catch (err) {
      // Defense-in-depth: ein fehlgeschlagener KI-Schritt darf NIEMALS die
      // ganze API mitreißen (vorher: unhandled exception im Loop → Prozess-
      // Crash für alle). Wir loggen + stoppen nur diesen Loop.
      this.log.error({ gameId, err }, "driveAIsLoop abgebrochen — KI-Schritt fehlgeschlagen");
    }
  }

  // ─── Bodensee events ──────────────────────────────────────────────
  //
  // Eigener WS-Pfad für die 2-Spieler-Variante. Bewusst getrennte Events
  // (`bodensee:*`) und ein eigener `BodenseeGameService` — der Kreuz/Solo-
  // Pfad oben bleibt davon unberührt. Auth-Middleware, Rate-Limit-Guards,
  // Lock-Service und der Room-Mechanismus werden geteilt.

  @SubscribeMessage("bodensee:join")
  async onBodenseeJoin(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { gameId?: string }
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return this.failBodensee(socket, "Not authenticated");
    const gameId = payload?.gameId;
    if (typeof gameId !== "string" || gameId.length === 0) {
      return this.failBodensee(socket, "gameId required");
    }
    try {
      const view = await this.bodenseeGames.viewForUser(gameId, userId);
      await socket.join(roomKey(gameId));
      socket.emit("bodensee:state", view);
      // Ist der Tisch im Ansage-Modus und eine KI ist Ansager, muss die
      // KI-Loop angestoßen werden (analog zum Kreuz-`onJoin`). Lock-
      // geschützt gegen parallele `bodensee:announce`-Events.
      if (view.status === "announcing" && view.announcement?.iAmAnnouncer !== true) {
        await this.locks.withLock(gameId, async () => {
          await this.driveBodenseeAIsLoop(gameId);
        });
      }
    } catch (err) {
      this.failBodensee(socket, this.errorMessage(err));
    }
  }

  @SubscribeMessage("bodensee:announce")
  async onBodenseeAnnounce(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { gameId?: string; announcement?: unknown }
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return this.failBodensee(socket, "Not authenticated");
    const gameId = payload?.gameId;
    const announcement = payload?.announcement;
    if (typeof gameId !== "string" || !isBodenseeAnnouncement(announcement)) {
      return this.failBodensee(socket, "gameId + announcement { variant: { mode } } required");
    }
    try {
      await this.locks.withLock(gameId, async () => {
        await this.bodenseeGames.applyAnnouncementAsUser(gameId, userId, announcement);
        await this.broadcastBodenseeState(gameId);
        // Nach der Ansage kann sofort eine KI am Zug sein → Loop drehen.
        await this.driveBodenseeAIsLoop(gameId);
      });
    } catch (err) {
      this.failBodensee(socket, this.errorMessage(err));
    }
  }

  @SubscribeMessage("bodensee:move")
  async onBodenseeMove(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { gameId?: string; card?: { suit?: string; rank?: string } }
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return this.failBodensee(socket, "Not authenticated");
    const gameId = payload?.gameId;
    const card = payload?.card;
    if (
      typeof gameId !== "string" ||
      !card ||
      typeof card.suit !== "string" ||
      typeof card.rank !== "string"
    ) {
      return this.failBodensee(socket, "gameId + card { suit, rank } required");
    }
    try {
      // Single-Owner-Lock: User-Move + KI-Loop laufen als atomarer Block.
      await this.locks.withLock(gameId, async () => {
        const { view } = await this.bodenseeGames.playMoveAsUser(gameId, userId, {
          suit: card.suit as never,
          rank: card.rank as never,
        });
        await this.broadcastBodenseeState(gameId);
        if (view.status === "finished") {
          this.server.to(roomKey(gameId)).emit("bodensee:ended", { finalScore: view.finalScore });
          return;
        }
        await this.driveBodenseeAIsLoop(gameId);
      });
    } catch (err) {
      this.failBodensee(socket, this.errorMessage(err));
    }
  }

  /**
   * KI-Loop für den Bodensee-Tisch — deckt Ansage- und Move-Phase ab.
   * Bodensee kennt kein Schieben: pro Spiel gibt es genau eine Ansage,
   * danach 36 Move-Schritte (18 Stiche × 2 Spieler). Die Sicherheits-
   * grenze von 50 Iterationen liegt komfortabel darüber.
   */
  private async driveBodenseeAIsLoop(gameId: string): Promise<void> {
    let announceSteps = 0;
    for (let i = 0; i < 50; i++) {
      const action = await this.bodenseeGames.nextAIAction(gameId);
      if (!action) return; // Mensch ist dran oder Spiel vorbei

      if (action.kind === "announce") {
        if (++announceSteps > 1) {
          this.log.error({ gameId, seat: action.seat }, "Bodensee-Ansage-Loop > 1 — fail-safe");
          return;
        }
        const decision = await this.bodenseeGames.aiChooseAnnouncement(gameId, action.seat);
        await this.bodenseeGames.applyAnnouncementAsSeat(gameId, action.seat, decision);
        await this.broadcastBodenseeState(gameId);
        await sleep(aiStepDelayMs());
        continue;
      }

      const card = await this.bodenseeGames.aiChooseMove(gameId, action.seat);
      const { view } = await this.bodenseeGames.playMoveAsSeat(gameId, action.seat, card);
      await this.broadcastBodenseeState(gameId);
      if (view.status === "finished") {
        this.server.to(roomKey(gameId)).emit("bodensee:ended", { finalScore: view.finalScore });
        return;
      }
      await sleep(aiStepDelayMs());
    }
    this.log.warn({ gameId }, "driveBodenseeAIsLoop hat Sicherheitsgrenze erreicht");
  }

  /**
   * Pusht an jeden Socket im Bodensee-Room dessen **eigene** Sicht — pro
   * Socket individuell gefiltert, damit kein Spieler die verdeckten Karten
   * des Gegners sieht. Spiegelt `broadcastState` für den Kreuz-Pfad.
   */
  private async broadcastBodenseeState(gameId: string): Promise<void> {
    const sockets = (await this.server.in(roomKey(gameId)).fetchSockets()) as unknown as Array<{
      data: SocketData;
      emit(event: string, payload: unknown): boolean;
    }>;
    for (const sock of sockets) {
      const userId = sock.data.userId;
      if (!userId) continue;
      try {
        const view: BodenseePlayerView = await this.bodenseeGames.viewForUser(gameId, userId);
        sock.emit("bodensee:state", view);
      } catch (err) {
        sock.emit("bodensee:error", { message: this.errorMessage(err) });
      }
    }
  }

  private failBodensee(socket: AuthenticatedSocket, message: string): void {
    socket.emit("bodensee:error", { message });
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
 * Minimal-Validierung einer Bodensee-Ansage aus dem WS-Payload. Die
 * inhaltliche Prüfung (gültiger Modus, Trumpf-Farbe etc.) übernimmt die
 * Engine in `newBodenseeRound`; hier wird nur die grobe Struktur geprüft,
 * damit der Cast auf `Announcement` ehrlich ist.
 */
function isBodenseeAnnouncement(v: unknown): v is Announcement {
  if (typeof v !== "object" || v === null) return false;
  const variant = (v as { variant?: unknown }).variant;
  if (typeof variant !== "object" || variant === null) return false;
  return typeof (variant as { mode?: unknown }).mode === "string";
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
