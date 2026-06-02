/**
 * **State + Timer für Disconnect-Voting**.
 *
 * Trennt sich von der reinen Aggregator-Logik (`disconnect-vote.ts`)
 * in zwei Aufgaben:
 *
 *   1. **Lebenszyklus-Verwaltung**: Phase + Restzeit pro Game in Redis,
 *      mit Timer im Node-Process. Boot-Recovery liest verbleibende
 *      Disconnect-Sessions wieder ein.
 *   2. **Outcome anwenden**: bei `STOP` → Tisch schließen; bei `FILL` →
 *      `GameService.markUserLeft` (Sitz wird KI); bei `WAIT` → nächste
 *      Phase starten.
 *
 * **Zeitfenster** (Spec):
 *   - GRACE_1 — 120 s Stille, nur Overlay + Countdown.
 *   - VOTE_1  — 15 s Vote-Fenster. Ergebnis-Auswertung sofort, sobald
 *               alle Menschen abgestimmt haben, sonst beim Timeout.
 *   - GRACE_2 — 60 s zusätzlicher Reconnect-Versuch.
 *   - VOTE_2  — 15 s, gleiche Mechanik wie VOTE_1, plus
 *               Einstimmigkeits-Regel für WAIT_AGAIN + STOP-Veto.
 *
 * **Timer in-memory**: bei Single-Instance ausreichend. Bei
 * Multi-Instance-Skalierung (M11) müsste ein Redis-basiertes
 * Expire-Notification-Pattern her, oder ein Job-Queue (BullMQ). Wir
 * sind explizit noch im Single-Instance-Modus, also bewusst Pragma.
 *
 * **Server-Restart**: alle in Redis liegenden Disconnect-Sessions
 * werden beim Boot eingelesen und mit ihrer Rest-Zeit weitergeführt.
 * Ist die Phase bereits abgelaufen, wird sofort weitergeschaltet.
 */
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Server } from "socket.io";

import { AuditService } from "../audit/audit.service.js";
import { RedisService } from "../redis/redis.service.js";
import {
  aggregate,
  isWaitAgainAllowed,
  type VoteChoice,
  type VoteOutcome,
  type VoteParticipant,
  type VotePhase,
} from "./disconnect-vote.js";

export type DisconnectPhase = "GRACE_1" | "VOTE_1" | "GRACE_2" | "VOTE_2" | "CLOSED" | "CONTINUED";

export interface DisconnectState {
  phase: DisconnectPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  disconnectedSeats: Array<{ seat: number; userId: string }>;
  participants: VoteParticipant[];
  votes: Record<number, VoteChoice>;
  aiAutoVotes: Array<{ seat: number; choice: VoteChoice }>;
  resultMessage: string | null;
  resultOutcome: "STOP" | "WAIT" | "FILL" | null;
}

/**
 * Phasen-Dauern in ms. Production-Defaults:
 *   GRACE_1 = 120 s, VOTE_1 = 15 s, GRACE_2 = 60 s, VOTE_2 = 15 s.
 *
 * Tests überschreiben via `DISCONNECT_PHASE_MS_SCALE` (z.B. "0.05" =
 * 5% der Dauer → GRACE_1 wird 6 s statt 120 s). Production darf das
 * NICHT setzen; `main.ts:assertNoUnsafeFlagsInProduction` blockt das.
 *
 * **Wichtig**: jeden Aufruf lazy evaluieren, nicht als Modul-Konstante.
 * Sonst greift die Env-Variable nicht, falls sie nach dem ersten
 * Modul-Import gesetzt wird (z.B. im Integration-Test-Setup vor dem
 * NestFactory.create — die env-Reihenfolge ist da fragil).
 */
function phaseDuration(phase: "GRACE_1" | "VOTE_1" | "GRACE_2" | "VOTE_2"): number {
  const scale = Number(process.env["DISCONNECT_PHASE_MS_SCALE"] ?? "1");
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const base: Record<typeof phase, number> = {
    GRACE_1: 120_000,
    VOTE_1: 15_000,
    GRACE_2: 60_000,
    VOTE_2: 15_000,
  };
  return Math.max(100, Math.round(base[phase] * factor));
}

/**
 * Outcome-Hooks. Der Service ruft die Methoden, die das umliegende
 * Game-Modul registriert hat — damit kein zirkulärer Import nötig ist.
 */
export interface DisconnectOutcomeHooks {
  /** Tisch schließen + alle in die Lobby. Reason für AuditLog + UI. */
  closeTable(gameId: string, reason: string): Promise<void>;
  /**
   * Den (disconnected) Sitz `seat` durch eine KI ersetzen, anschließend
   * den Game-Loop weiterdrehen lassen. `userId` für Audit.
   */
  replaceSeatWithAi(gameId: string, seat: number, userId: string): Promise<void>;
  /** Disconnect ist vorbei (Reconnect oder WAIT-Phasen alle durch). */
  resumeGame(gameId: string): Promise<void>;
  /** System-Nachricht im Chat des Games — ephemer, nicht persistiert. */
  postChatSystemMessage(gameId: string, body: string): void;
}

@Injectable()
export class DisconnectVoteService implements OnModuleInit {
  private readonly log = new Logger(DisconnectVoteService.name);

  /** Timer-Handles pro Game (in-memory, nicht persistent). */
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Server-Referenz für Broadcasts. Vom GameGateway via setServer() injiziert. */
  private server: Server | null = null;
  /** Outcome-Hooks vom GameModule via setHooks() injiziert. */
  private hooks: DisconnectOutcomeHooks | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly audit: AuditService
  ) {}

  onModuleInit(): void {
    // Recovery-Lauf beim Boot — *nicht* im Constructor, weil DI dort
    // noch nicht voll initialisiert ist. Außerdem brauchen wir die
    // Hooks erst, wenn das GameGateway sie gesetzt hat — der Recovery-
    // Sweep läuft also lazy aus `setHooks()`.
  }

  /** Vom GameGateway aufgerufen, um Broadcasts ermöglichen. */
  setServer(server: Server): void {
    this.server = server;
  }

  /**
   * Hooks injizieren UND Recovery-Lauf starten. Wird vom GameModule
   * in dessen `onModuleInit` aufgerufen, sobald GameService bereit ist.
   */
  async setHooks(hooks: DisconnectOutcomeHooks): Promise<void> {
    this.hooks = hooks;
    await this.recoverAllPendingFromBoot();
  }

  // ────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────

  /**
   * Vom GameGateway aufgerufen, wenn ein User keinen aktiven Socket
   * mehr hat UND er an einem laufenden Spiel sitzt.
   */
  async onSeatDisconnected(
    gameId: string,
    seat: number,
    userId: string,
    participants: VoteParticipant[]
  ): Promise<void> {
    const existing = await this.loadState(gameId);

    if (existing && (existing.phase === "CLOSED" || existing.phase === "CONTINUED")) {
      // Alte Session war abgeschlossen — reset.
      this.cancelTimer(gameId);
      await this.deleteState(gameId);
    }
    const state = (await this.loadState(gameId)) ?? this.newState(participants);

    if (state.disconnectedSeats.some((s) => s.seat === seat)) {
      return; // schon erfasst, no-op
    }
    state.disconnectedSeats.push({ seat, userId });

    // Wenn wir noch in keiner aktiven Phase sind, GRACE_1 starten.
    if (state.phase === "CONTINUED" || state.phase === "CLOSED") {
      state.phase = "GRACE_1";
      const now = Date.now();
      state.phaseStartedAt = now;
      state.phaseEndsAt = now + phaseDuration("GRACE_1");
    }
    await this.saveState(gameId, state);

    await this.audit.record({
      action: "game.disconnect.seat",
      target: gameId,
      meta: { seat, userId, phase: state.phase },
    });

    this.postSystem(gameId, `Sitz ${seat} hat die Verbindung verloren.`);
    this.broadcast(gameId, state);
    this.scheduleNextTransition(gameId, state);
  }

  /**
   * Vom GameGateway aufgerufen, sobald ein User reconnected
   * (Socket wieder offen + er sitzt im Game).
   */
  async onSeatReconnected(gameId: string, userId: string): Promise<void> {
    const state = await this.loadState(gameId);
    if (!state) return;
    const seatIdx = state.disconnectedSeats.findIndex((s) => s.userId === userId);
    if (seatIdx === -1) return;
    state.disconnectedSeats.splice(seatIdx, 1);

    if (state.disconnectedSeats.length === 0) {
      // Alle wieder da → Spiel geht weiter.
      this.cancelTimer(gameId);
      state.phase = "CONTINUED";
      state.phaseStartedAt = Date.now();
      state.phaseEndsAt = state.phaseStartedAt;
      state.resultMessage = "Alle Spieler sind wieder verbunden — das Spiel läuft weiter.";
      state.resultOutcome = null;
      await this.saveState(gameId, state);
      this.postSystem(gameId, "✔ Alle Spieler wieder verbunden — Spiel läuft weiter.");
      this.broadcast(gameId, state);
      await this.hooks?.resumeGame(gameId);
      // Nach kurzem Info-Linger den Clients autoritativ „vorbei" melden +
      // State löschen (siehe scheduleClear). Der Client-Timer ist nur Fallback.
      this.scheduleClear(gameId, 3000);
      return;
    }
    await this.saveState(gameId, state);
    this.broadcast(gameId, state);
  }

  /**
   * Vom GameGateway aufgerufen, wenn ein User eine Vote-Wahl absetzt.
   * Wirft `Error` bei ungültiger Stimme/Phase — Gateway mapped das zu
   * `game:error`.
   */
  async castVote(gameId: string, userId: string, seat: number, choice: VoteChoice): Promise<void> {
    const state = await this.loadState(gameId);
    if (!state) {
      throw new Error("Keine aktive Disconnect-Abstimmung an diesem Tisch.");
    }
    if (state.phase !== "VOTE_1" && state.phase !== "VOTE_2") {
      throw new Error(`Aktuell läuft keine Abstimmung (Phase ${state.phase}).`);
    }
    // Stimm-Sitz muss in den Participants als HUMAN sein.
    const participant = state.participants.find((p) => p.seat === seat);
    if (!participant || participant.kind !== "HUMAN") {
      throw new Error(`Sitz ${seat} darf nicht abstimmen.`);
    }
    // Sitz darf nicht disconnected sein.
    if (state.disconnectedSeats.some((d) => d.seat === seat)) {
      throw new Error("Du bist disconnected — eine Stimme von dir wäre paradox.");
    }
    // WAIT in VOTE_2 nur wenn noch erlaubt (Einstimmigkeit).
    if (
      state.phase === "VOTE_2" &&
      choice === "WAIT" &&
      !isWaitAgainAllowed("VOTE_2", state.votes)
    ) {
      throw new Error(
        "Eine weitere Minute warten ist nur bei Einstimmigkeit möglich — Option nicht mehr wählbar."
      );
    }

    const previousAllowed = isWaitAgainAllowed(state.phase, state.votes);
    state.votes[seat] = choice;
    const nowAllowed = isWaitAgainAllowed(state.phase, state.votes);

    // Wenn der erste Non-WAIT-Vote in VOTE_2 eingegangen ist, posten wir
    // den Hinweis genau einmal.
    if (state.phase === "VOTE_2" && previousAllowed && !nowAllowed) {
      this.postSystem(gameId, "ℹ Eine weitere Minute warten ist nur bei Einstimmigkeit möglich.");
    }

    await this.audit.record({
      action: "game.disconnect.vote",
      actorId: userId,
      target: gameId,
      meta: { seat, choice, phase: state.phase },
    });

    await this.saveState(gameId, state);
    this.broadcast(gameId, state);

    // Sofort auswerten — die Aggregator-Logik gibt PENDING zurück, wenn
    // noch nicht alle Menschen abgestimmt haben.
    await this.tryFinalizeVote(gameId, state, /* votingClosed */ false);
  }

  /** Liefert den aktuellen State (für initiales `game:join`-Broadcast). */
  async getState(gameId: string): Promise<DisconnectState | null> {
    return this.loadState(gameId);
  }

  // ────────────────────────────────────────────────────────────────────
  // Phasen-Übergänge
  // ────────────────────────────────────────────────────────────────────

  /**
   * Plant den nächsten Phasen-Übergang via setTimeout. Beim Recovery
   * wird die Differenz zu `phaseEndsAt` als Delay verwendet.
   */
  private scheduleNextTransition(gameId: string, state: DisconnectState): void {
    this.cancelTimer(gameId);
    const delay = Math.max(0, state.phaseEndsAt - Date.now());
    const handle = setTimeout(() => {
      void this.advancePhase(gameId).catch((err) => {
        this.log.error({ err, gameId }, "advancePhase fehlgeschlagen");
      });
    }, delay);
    this.timers.set(gameId, handle);
  }

  /**
   * Tatsächlicher Phasen-Übergang, ausgelöst entweder durch Timer oder
   * durch sofortige Vote-Auswertung (alle Stimmen da).
   */
  private async advancePhase(gameId: string): Promise<void> {
    const state = await this.loadState(gameId);
    if (!state) return;

    switch (state.phase) {
      case "GRACE_1":
        await this.startVote(gameId, state, "VOTE_1");
        break;
      case "VOTE_1":
        await this.tryFinalizeVote(gameId, state, /* votingClosed */ true);
        break;
      case "GRACE_2":
        await this.startVote(gameId, state, "VOTE_2");
        break;
      case "VOTE_2":
        await this.tryFinalizeVote(gameId, state, /* votingClosed */ true);
        break;
      case "CLOSED":
      case "CONTINUED":
        // Nichts zu tun.
        break;
    }
  }

  private async startVote(gameId: string, state: DisconnectState, phase: VotePhase): Promise<void> {
    const now = Date.now();
    state.phase = phase;
    state.phaseStartedAt = now;
    state.phaseEndsAt = now + phaseDuration(phase);
    state.votes = {};
    state.aiAutoVotes = [];
    await this.saveState(gameId, state);
    this.postSystem(
      gameId,
      phase === "VOTE_1"
        ? "🗳 Abstimmung gestartet (15 s): Beenden / 1 Minute warten / Mit KI weiterspielen."
        : "🗳 Zweite Abstimmung (15 s): Beenden / Weitere Minute warten / Mit KI weiterspielen."
    );
    this.broadcast(gameId, state);
    this.scheduleNextTransition(gameId, state);
  }

  private async tryFinalizeVote(
    gameId: string,
    state: DisconnectState,
    votingClosed: boolean
  ): Promise<void> {
    if (state.phase !== "VOTE_1" && state.phase !== "VOTE_2") return;
    const outcome = aggregate({
      phase: state.phase,
      participants: state.participants,
      humanVotes: state.votes,
      votingClosed,
    });
    if (outcome.result === "PENDING") return; // Nichts zu tun, warten

    state.aiAutoVotes = [...outcome.aiAutoVotes];
    // KI-Stimmen als System-Nachricht posten (Spec).
    for (const ai of outcome.aiAutoVotes) {
      const label = aiVoteLabel(state.phase, state.participants.length, ai.choice);
      this.postSystem(gameId, `🤖 KI Sitz ${ai.seat}: ${label}`);
    }

    state.resultOutcome = outcome.effective!;
    state.resultMessage = outcome.reason;
    await this.applyOutcome(gameId, state, outcome);
  }

  private async applyOutcome(
    gameId: string,
    state: DisconnectState,
    outcome: VoteOutcome
  ): Promise<void> {
    this.cancelTimer(gameId);

    if (outcome.effective === "STOP") {
      state.phase = "CLOSED";
      state.phaseStartedAt = Date.now();
      state.phaseEndsAt = state.phaseStartedAt;
      await this.saveState(gameId, state);
      this.postSystem(gameId, `❌ ${outcome.reason}`);
      this.broadcast(gameId, state);
      await this.hooks?.closeTable(gameId, outcome.reason);
      return;
    }
    if (outcome.effective === "FILL") {
      state.phase = "CONTINUED";
      state.phaseStartedAt = Date.now();
      state.phaseEndsAt = state.phaseStartedAt;
      await this.saveState(gameId, state);
      this.postSystem(gameId, `🤖 ${outcome.reason} — KI übernimmt offene Sitze.`);
      this.broadcast(gameId, state);
      // Alle disconnected Sitze in KIs umwandeln.
      for (const ds of state.disconnectedSeats) {
        await this.hooks?.replaceSeatWithAi(gameId, ds.seat, ds.userId);
      }
      await this.hooks?.resumeGame(gameId);
      this.scheduleClear(gameId, 3000);
      return;
    }
    if (outcome.effective === "WAIT") {
      // VOTE_1 → GRACE_2; VOTE_2 → noch eine GRACE-Phase? Spec sagt:
      // VOTE_2 mit WAIT-Einstimmigkeit → noch 1 Min warten, dann
      // theoretisch eine VOTE_3? In meiner Lesung der Spec gibt es
      // nach VOTE_2-WAIT noch eine letzte GRACE-Minute, danach wird
      // bei nicht-Reconnect automatisch geschlossen (kein weiteres
      // Vote). Konservativ + minimiert das „endlos warten"-Szenario.
      const fromVote2 = state.phase === "VOTE_2";
      const now = Date.now();
      state.phase = "GRACE_2";
      state.phaseStartedAt = now;
      state.phaseEndsAt = now + phaseDuration("GRACE_2");
      state.votes = {};
      await this.saveState(gameId, state);
      this.postSystem(
        gameId,
        fromVote2
          ? "⏳ Letzte Minute: Reconnect noch möglich, danach wird der Tisch automatisch geschlossen."
          : `✔ ${outcome.reason} — 1 Minute Wartezeit beginnt.`
      );
      this.broadcast(gameId, state);
      // Bei zweiter Wartephase: kein neuer Vote danach, sondern
      // automatischer Close, falls niemand reconnected.
      if (fromVote2) {
        // Custom timer: nach GRACE_2 (1 min) direkt close, kein Vote_3.
        this.cancelTimer(gameId);
        const handle = setTimeout(() => {
          void this.autoCloseAfterFinalWait(gameId).catch((err) => {
            this.log.error({ err, gameId }, "autoClose fehlgeschlagen");
          });
        }, phaseDuration("GRACE_2"));
        this.timers.set(gameId, handle);
      } else {
        this.scheduleNextTransition(gameId, state);
      }
    }
  }

  /** Letzte WAIT-Periode (nach VOTE_2-Einstimmigkeit) abgelaufen, niemand reconnected → close. */
  private async autoCloseAfterFinalWait(gameId: string): Promise<void> {
    const state = await this.loadState(gameId);
    if (!state) return;
    if (state.disconnectedSeats.length === 0) return; // sollte nicht passieren — Reconnect hat State schon geräumt
    state.phase = "CLOSED";
    state.resultMessage = "Niemand ist zurückgekommen — Tisch wird aufgelöst.";
    state.resultOutcome = "STOP";
    await this.saveState(gameId, state);
    this.postSystem(gameId, `❌ ${state.resultMessage}`);
    this.broadcast(gameId, state);
    await this.hooks?.closeTable(gameId, state.resultMessage);
  }

  // ────────────────────────────────────────────────────────────────────
  // Persistence
  // ────────────────────────────────────────────────────────────────────

  private key(gameId: string): string {
    return `game:${gameId}:disconnect`;
  }

  private async loadState(gameId: string): Promise<DisconnectState | null> {
    const raw = await this.redis.client.get(this.key(gameId));
    if (!raw) return null;
    return JSON.parse(raw) as DisconnectState;
  }

  private async saveState(gameId: string, state: DisconnectState): Promise<void> {
    // TTL 1h, damit verloren gegangene States nicht ewig liegen.
    await this.redis.client.set(this.key(gameId), JSON.stringify(state), "EX", 3600);
  }

  private async deleteState(gameId: string): Promise<void> {
    await this.redis.client.del(this.key(gameId));
  }

  private newState(participants: VoteParticipant[]): DisconnectState {
    const now = Date.now();
    return {
      phase: "CONTINUED",
      phaseStartedAt: now,
      phaseEndsAt: now,
      disconnectedSeats: [],
      participants,
      votes: {},
      aiAutoVotes: [],
      resultMessage: null,
      resultOutcome: null,
    };
  }

  private cancelTimer(gameId: string): void {
    const t = this.timers.get(gameId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(gameId);
    }
  }

  /**
   * Beim Boot: alle in Redis liegenden Disconnect-Sessions reaktivieren.
   * Wenn die Phase bereits abgelaufen ist, sofort weiterschalten; sonst
   * Timer auf die Rest-Zeit setzen.
   */
  private async recoverAllPendingFromBoot(): Promise<void> {
    try {
      const keys = await this.redis.client.keys("game:*:disconnect");
      for (const key of keys) {
        const gameId = key.split(":")[1];
        if (!gameId) continue;
        const state = await this.loadState(gameId);
        if (!state) continue;
        if (state.phase === "CLOSED" || state.phase === "CONTINUED") {
          await this.deleteState(gameId);
          continue;
        }
        this.log.log(
          { gameId, phase: state.phase, restMs: state.phaseEndsAt - Date.now() },
          "Disconnect-State nach Boot wieder aktiviert"
        );
        this.scheduleNextTransition(gameId, state);
      }
    } catch (err) {
      this.log.error({ err }, "Recovery der Disconnect-States fehlgeschlagen");
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Broadcast + Chat
  // ────────────────────────────────────────────────────────────────────

  private broadcast(gameId: string, state: DisconnectState): void {
    if (!this.server) return;
    this.server.to(`game:${gameId}`).emit("game:disconnect-state", state);
  }

  /**
   * Sagt allen Clients im Game-Room AUTORITATIV „die Disconnect-Episode ist
   * vorbei — blendet euer Overlay aus". Wird vor dem Löschen des Server-States
   * gesendet. Ohne dieses Event müsste der Client das Ende nur erraten (Timer);
   * mit ihm ist es ein echter Server→Client-Abgleich.
   */
  private broadcastCleared(gameId: string): void {
    if (!this.server) return;
    this.server.to(`game:${gameId}`).emit("game:disconnect-cleared", { gameId });
  }

  /**
   * Räumt einen abgeschlossenen CONTINUED-State nach kurzem Info-Linger weg —
   * und schickt den Clients VORHER das explizite `game:disconnect-cleared`
   * (primärer Abgleich; der Client-Timer ist nur noch Fallback). Ein
   * zwischenzeitlich neu gestarteter Disconnect-Flow (Phase ≠ CONTINUED) bleibt
   * unangetastet — wir räumen nur den eigenen, lingernden Endzustand weg.
   */
  private scheduleClear(gameId: string, lingerMs: number): void {
    setTimeout(() => {
      void (async () => {
        const cur = await this.loadState(gameId).catch(() => null);
        // Neuer Flow zwischenzeitlich gestartet (GRACE/VOTE) oder CLOSED (wartet
        // auf User-OK) → nicht anfassen.
        if (cur && cur.phase !== "CONTINUED") return;
        this.broadcastCleared(gameId);
        if (cur) await this.deleteState(gameId).catch(() => undefined);
      })();
    }, lingerMs);
  }

  private postSystem(gameId: string, body: string): void {
    if (!this.hooks) return;
    try {
      this.hooks.postChatSystemMessage(gameId, body);
    } catch {
      // System-Nachricht darf den Flow nicht stoppen.
    }
  }
}

/**
 * Menschen-lesbares Label für eine KI-Auto-Vote-Wahl. Wird in der
 * Chat-System-Nachricht angezeigt.
 */
function aiVoteLabel(phase: VotePhase, _participantsCount: number, choice: VoteChoice): string {
  switch (choice) {
    case "STOP":
      return "ich stimme deiner Entscheidung zu (beenden).";
    case "WAIT":
      return phase === "VOTE_1"
        ? "ich stimme für 1 Minute warten."
        : "ich unterstütze 1 weitere Minute warten.";
    case "FILL":
      return "ich stimme für weiterspielen mit zusätzlicher KI.";
  }
}
