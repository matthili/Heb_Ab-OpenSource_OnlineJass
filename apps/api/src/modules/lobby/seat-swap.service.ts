/**
 * Sitzplatz-Tausch + Start-Countdown im Tisch-Wartebereich (4er/Solo).
 *
 * Hält den **ephemeren** Zustand rund um die Sitz-Aufstellung VOR dem Spiel:
 *   - **Start-Countdown**: Ist der Tisch voll, startet das Spiel nicht sofort,
 *     sondern nach einem kurzen sichtbaren Countdown. Das gibt den Spielern ein
 *     Zeitfenster zum Tauschen. Ein gestarteter Tausch bricht den Countdown ab;
 *     nach Auflösung läuft er neu.
 *   - **Tausch-Protokoll** (Mensch ↔ Mensch, mit Einverständnis):
 *       Stufe 1 „auswählen" (Anfragender drückt „tauschen", wählt einen Sitz) —
 *         Timeout 30 s, jederzeit abbrechbar.
 *       Stufe 2 „Rückfrage" (Ziel antwortet) — Timeout 15 s → automatisch
 *         „möchte nicht wechseln".
 *   - **Cooldown** (15 s) für den Anfragenden nach einer beantworteten/abgelaufenen
 *     Rückfrage, bevor er erneut tauschen darf.
 *   - **„Nicht mehr fragen"**: ein Ziel kann festlegen, dass ein bestimmter
 *     Anfragender es an diesem Tisch nicht mehr fragen darf.
 *
 * Alles **in-memory** (Single-Instance; der Tausch ist ein flüchtiger
 * Vorspiel-Vorgang, der bei einem Neustart bedeutungslos ist). Die eigentlichen
 * DB-Mutationen (Sitze tauschen, Spiel starten) macht der {@link LobbyService};
 * dieser Service hält nur Zustand + Timer und ruft den LobbyService zurück.
 *
 * Frei/KI-Sitze werden NICHT hier behandelt — die nimmt man direkt (LobbyService
 * `takeSeat`), ohne Einverständnis. Dieses Protokoll ist nur für den Tausch mit
 * einem MENSCHEN.
 */
import { ForbiddenException, Inject, Injectable, forwardRef } from "@nestjs/common";

import { LobbyGateway } from "./lobby.gateway.js";
import { LobbyService } from "./lobby.service.js";

/** Kurzer Start-Countdown bei vollem Tisch, bevor das Spiel automatisch beginnt. */
const START_COUNTDOWN_MS = 8_000;
/** Stufe 1: Anfragender hat so lange Zeit, einen Tauschpartner zu wählen. */
const SELECT_TIMEOUT_MS = 30_000;
/** Stufe 2: Ziel hat so lange Zeit zu antworten, sonst „möchte nicht wechseln". */
const RESPONSE_TIMEOUT_MS = 15_000;
/** Sperre für den Anfragenden nach einer aufgelösten Rückfrage. */
const COOLDOWN_MS = 15_000;

type SwapStage = "selecting" | "awaiting-response";
export type SwapAnswer = "accept" | "decline" | "decline-forever";

interface PendingSwap {
  requesterId: string;
  requesterSeat: number;
  stage: SwapStage;
  /** In `awaiting-response` gesetzt. */
  targetId: string | null;
  targetSeat: number | null;
  /** Epoch-ms, wann die aktuelle Stufe abläuft (Client rendert den Countdown). */
  deadline: number;
  timer: NodeJS.Timeout;
}

/** Snapshot für die TableDetailView — was Clients über den laufenden Tausch sehen. */
export interface SeatSwapSnapshot {
  stage: SwapStage;
  requesterId: string;
  requesterSeat: number;
  targetId: string | null;
  targetSeat: number | null;
  deadline: number;
}

@Injectable()
export class SeatSwapService {
  /** Höchstens ein laufender Tausch pro Tisch. */
  private readonly pending = new Map<string, PendingSwap>();
  /** Start-Countdown pro Tisch (voll → Spiel startet bei `startAt`). */
  private readonly startCountdowns = new Map<string, { startAt: number; timer: NodeJS.Timeout }>();
  /** Cooldown pro Tisch: Anfragender-ID → frei-ab Epoch-ms. */
  private readonly cooldownUntil = new Map<string, Map<string, number>>();
  /** „Nicht mehr fragen" pro Tisch: Set von `${requesterId}>${targetId}`. */
  private readonly declinedPairs = new Map<string, Set<string>>();

  constructor(
    // forwardRef wegen zirkulärer Abhängigkeit LobbyService ↔ SeatSwapService:
    // der LobbyService validiert + ruft uns (request/pick/respond), wir rufen
    // den LobbyService für die DB-Mutationen (Sitze tauschen, Spiel starten).
    @Inject(forwardRef(() => LobbyService))
    private readonly lobby: LobbyService,
    private readonly gateway: LobbyGateway
  ) {}

  // ─── Abfragen (für tryAutoStartGame + View) ────────────────────────

  /** Läuft gerade ein Tausch? Solange ja, darf der Tisch NICHT automatisch starten. */
  isBusy(tableId: string): boolean {
    return this.pending.has(tableId);
  }

  /** Aktueller Tausch-Stand für die View (oder null). */
  snapshot(tableId: string): SeatSwapSnapshot | null {
    const p = this.pending.get(tableId);
    if (!p) return null;
    return {
      stage: p.stage,
      requesterId: p.requesterId,
      requesterSeat: p.requesterSeat,
      targetId: p.targetId,
      targetSeat: p.targetSeat,
      deadline: p.deadline,
    };
  }

  /** Start-Countdown-Stand für die View (oder null). */
  startCountdownSnapshot(tableId: string): { startAt: number } | null {
    const c = this.startCountdowns.get(tableId);
    return c ? { startAt: c.startAt } : null;
  }

  /** Verbleibender Cooldown in Sekunden für einen Anfragenden (0 = frei). */
  cooldownRemainingSeconds(tableId: string, userId: string): number {
    const until = this.cooldownUntil.get(tableId)?.get(userId) ?? 0;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  // ─── Start-Countdown ───────────────────────────────────────────────

  /**
   * (Re-)armiert den Start-Countdown für einen vollen Tisch. Jeder Aufruf setzt
   * die Frist frisch (eine Sitz-Mutation gibt also neue {@link START_COUNTDOWN_MS}).
   * No-op, wenn gerade ein Tausch läuft (der blockt den Start ohnehin).
   */
  armStartCountdown(tableId: string): void {
    if (this.isBusy(tableId)) return;
    this.cancelStartCountdown(tableId);
    const startAt = Date.now() + START_COUNTDOWN_MS;
    const timer = setTimeout(() => {
      this.startCountdowns.delete(tableId);
      // Der LobbyService prüft selbst nochmal (noch voll? noch WAITING? kein
      // Tausch?) und startet dann. Fehler werden dort geloggt.
      void this.lobby.fireStartCountdown(tableId);
    }, START_COUNTDOWN_MS);
    timer.unref?.();
    this.startCountdowns.set(tableId, { startAt, timer });
  }

  cancelStartCountdown(tableId: string): void {
    const c = this.startCountdowns.get(tableId);
    if (c) {
      clearTimeout(c.timer);
      this.startCountdowns.delete(tableId);
    }
  }

  // ─── Tausch-Protokoll ──────────────────────────────────────────────

  /**
   * Stufe 1: Anfragender drückt „Sitzplatz tauschen". Blockt den Auto-Start und
   * öffnet das 30-s-Auswahlfenster. Validierung (sitzt am Tisch, WAITING, 4er/Solo)
   * macht der LobbyService vorher; hier nur Cooldown + „kein zweiter Tausch".
   */
  requestSwap(tableId: string, requesterId: string, requesterSeat: number): void {
    if (this.pending.has(tableId)) {
      throw new ForbiddenException("An diesem Tisch läuft bereits ein Sitzplatz-Tausch.");
    }
    const remaining = this.cooldownRemainingSeconds(tableId, requesterId);
    if (remaining > 0) {
      throw new ForbiddenException(
        `Bitte noch ${remaining} s warten, bevor du erneut tauschen möchtest.`
      );
    }
    this.cancelStartCountdown(tableId);
    const deadline = Date.now() + SELECT_TIMEOUT_MS;
    const timer = setTimeout(() => this.onSelectTimeout(tableId), SELECT_TIMEOUT_MS);
    timer.unref?.();
    this.pending.set(tableId, {
      requesterId,
      requesterSeat,
      stage: "selecting",
      targetId: null,
      targetSeat: null,
      deadline,
      timer,
    });
    void this.lobby.pushTableState(tableId);
  }

  /**
   * Stufe 2: Anfragender wählt das Ziel (ein menschlicher Sitz). Der LobbyService
   * hat geprüft, dass `targetSeat` ein Mensch ist, und reicht dessen `targetId`.
   */
  pickTarget(tableId: string, requesterId: string, targetSeat: number, targetId: string): void {
    const p = this.pending.get(tableId);
    if (!p || p.requesterId !== requesterId || p.stage !== "selecting") {
      throw new ForbiddenException("Kein offener Tausch in der Auswahl-Phase.");
    }
    if (targetId === requesterId) {
      throw new ForbiddenException("Mit dir selbst kannst du nicht tauschen.");
    }
    if (this.declinedPairs.get(tableId)?.has(pairKey(requesterId, targetId))) {
      throw new ForbiddenException("Dieser Spieler möchte von dir nicht mehr gefragt werden.");
    }
    clearTimeout(p.timer);
    p.stage = "awaiting-response";
    p.targetId = targetId;
    p.targetSeat = targetSeat;
    p.deadline = Date.now() + RESPONSE_TIMEOUT_MS;
    p.timer = setTimeout(() => this.onResponseTimeout(tableId), RESPONSE_TIMEOUT_MS);
    p.timer.unref?.();
    // Ziel bekommt den Rückfrage-Dialog (auf alle seine Tabs/Geräte).
    this.gateway.pushToUser(targetId, "lobby:seat-swap-prompt", {
      tableId,
      requesterId,
      requesterSeat: p.requesterSeat,
      targetSeat,
      deadline: p.deadline,
    });
    void this.lobby.pushTableState(tableId);
  }

  /** Stufe 2: Ziel antwortet. */
  respondSwap(tableId: string, targetId: string, answer: SwapAnswer): void {
    const p = this.pending.get(tableId);
    if (!p || p.stage !== "awaiting-response" || p.targetId !== targetId) {
      throw new ForbiddenException("Keine offene Tausch-Rückfrage für dich.");
    }
    clearTimeout(p.timer);
    const { requesterId, requesterSeat } = p;
    const targetSeat = p.targetSeat!;
    this.pending.delete(tableId);
    // Cooldown für den Anfragenden — er hat einen Wunsch geäußert, der das Ziel
    // erreicht hat (egal ob ja/nein).
    this.setCooldown(tableId, requesterId);

    if (answer === "decline-forever") {
      this.addDeclinedPair(tableId, requesterId, targetId);
    }

    if (answer === "accept") {
      // DB-Tausch im LobbyService; der re-armiert danach den Start-Countdown
      // und pusht den neuen State.
      void this.lobby.applyAcceptedSwap(tableId, requesterSeat, targetSeat, requesterId, targetId);
      this.gateway.pushToUser(requesterId, "lobby:seat-swap-result", {
        tableId,
        accepted: true,
      });
      return;
    }

    // Abgelehnt (mit/ohne „nicht mehr fragen"): Anfragenden informieren,
    // Auto-Start neu bewerten + State pushen (afterSwapResolved macht beides
    // in fester Reihenfolge, sonst Race zwischen Countdown-Arm und Push).
    this.gateway.pushToUser(requesterId, "lobby:seat-swap-result", {
      tableId,
      accepted: false,
      declinedForever: answer === "decline-forever",
    });
    void this.lobby.afterSwapResolved(tableId);
  }

  /** Anfragender bricht in der Auswahl-Phase ab (Stufe 1). */
  cancelSwap(tableId: string, requesterId: string): void {
    const p = this.pending.get(tableId);
    if (!p || p.requesterId !== requesterId) {
      throw new ForbiddenException("Du hast keinen offenen Tausch zum Abbrechen.");
    }
    clearTimeout(p.timer);
    this.pending.delete(tableId);
    // Kein Cooldown beim Selbst-Abbruch in der Auswahl-Phase.
    void this.lobby.afterSwapResolved(tableId);
  }

  /**
   * Räumt allen Tausch-Zustand eines Tisches (Spielstart, Tisch-Schließung,
   * Owner-Wechsel-Reset). Stoppt alle Timer.
   */
  clearTable(tableId: string): void {
    const p = this.pending.get(tableId);
    if (p) clearTimeout(p.timer);
    this.pending.delete(tableId);
    this.cancelStartCountdown(tableId);
    this.cooldownUntil.delete(tableId);
    this.declinedPairs.delete(tableId);
  }

  // ─── Timeouts ──────────────────────────────────────────────────────

  private onSelectTimeout(tableId: string): void {
    const p = this.pending.get(tableId);
    if (!p || p.stage !== "selecting") return;
    this.pending.delete(tableId);
    this.gateway.pushToUser(p.requesterId, "lobby:seat-swap-result", {
      tableId,
      accepted: false,
      timedOut: true,
    });
    void this.lobby.afterSwapResolved(tableId);
  }

  private onResponseTimeout(tableId: string): void {
    const p = this.pending.get(tableId);
    if (!p || p.stage !== "awaiting-response" || !p.targetId) return;
    this.pending.delete(tableId);
    // Wunsch hat das Ziel erreicht (kam nur keine Antwort) → Cooldown.
    this.setCooldown(tableId, p.requesterId);
    this.gateway.pushToUser(p.requesterId, "lobby:seat-swap-result", {
      tableId,
      accepted: false,
      timedOut: true,
    });
    // Ziel-Tabs: Dialog schließen (Frist abgelaufen).
    this.gateway.pushToUser(p.targetId, "lobby:seat-swap-cancelled", { tableId });
    void this.lobby.afterSwapResolved(tableId);
  }

  // ─── Helfer ────────────────────────────────────────────────────────

  private setCooldown(tableId: string, userId: string): void {
    let m = this.cooldownUntil.get(tableId);
    if (!m) {
      m = new Map();
      this.cooldownUntil.set(tableId, m);
    }
    m.set(userId, Date.now() + COOLDOWN_MS);
  }

  private addDeclinedPair(tableId: string, requesterId: string, targetId: string): void {
    let s = this.declinedPairs.get(tableId);
    if (!s) {
      s = new Set();
      this.declinedPairs.set(tableId, s);
    }
    s.add(pairKey(requesterId, targetId));
  }
}

function pairKey(requesterId: string, targetId: string): string {
  return `${requesterId}>${targetId}`;
}
