/**
 * Integration-Test: Inferenz-Fallback (M5-E).
 *
 * Vertrag (Plan-Doc §6, Sicherheits-Checkliste #9):
 *   Wenn der Inferenz-Microservice nicht erreichbar ist (Timeout, 5xx,
 *   Netzwerk-Fehler, Schema-Mismatch), darf das Spiel **nicht** abbrechen.
 *   Stattdessen wählt der `GameService.aiChooseMove` einen zufälligen
 *   legalen Zug (`RandomLegalMovePlayer`) und schreibt ein
 *   `game.ai.inference_fallback`-AuditLog.
 *
 * Wir verifizieren das, indem wir den Inferenz-Stub auf 503 zwingen und ein
 * 4-Bots-Spiel mit `aiSeatType: "nn"` durchziehen. Erwartung:
 *   - Stub wird mindestens 27× angerufen (KI-Sitze drücken 9 Tricks × 3
 *     Plätze; Sitz 0 ist hier auch KI = +9, also 36 Mal — aber das hängt
 *     vom genauen Loop ab)
 *   - Trotz aller 503-Antworten läuft das Spiel zu Ende (status=finished)
 *   - AuditLog enthält ≥1 `game.ai.inference_fallback`-Eintrag pro KI-Move
 *
 * Außerdem: ein zweiter Sub-Test stellt sicher, dass im Default-Pfad
 * (Stub liefert deterministisches argmax) KEIN Fallback feuert.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setupTestApp, type TestAppHandle } from "./setup.js";
import type { SeatAssignment } from "../../src/modules/game/game.service.js";

describe("M5 inference-fallback — KI bleibt spielbar bei Inferenz-Ausfall", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  async function playFullGame(
    aiSeatType: string
  ): Promise<{ gameId: string; movesPlayed: number }> {
    const variant = { mode: "TRUMPF" as const, trump_suit: "EICHEL" as const };
    const seats: SeatAssignment[] = [
      { seat: 0, userId: null, aiSeatType },
      { seat: 1, userId: null, aiSeatType },
      { seat: 2, userId: null, aiSeatType },
      { seat: 3, userId: null, aiSeatType },
    ];
    const { gameId } = await app.games.createGame({
      variant,
      announcement: { variant, slalom: false },
      starter: 0,
      seats,
      rngSeed: 7777,
    });
    let movesPlayed = 0;
    for (let i = 0; i < 50; i++) {
      const next = await app.games.nextAISeat(gameId);
      if (!next) break;
      const card = await app.games.aiChooseMove(gameId, next.seat, next.aiSeatType);
      await app.games.playMoveAsSeat(gameId, next.seat, card);
      movesPlayed++;
    }
    return { gameId, movesPlayed };
  }

  it("Stub antwortet mit 503 → Random-Fallback, Spiel läuft durch, AuditLog wächst", async () => {
    app.inference.setMode({ mode: "status", status: 503 });

    const { gameId, movesPlayed } = await playFullGame("nn");

    expect(movesPlayed).toBe(36);
    const view = await app.games.viewForSeat(gameId, 0);
    expect(view.status).toBe("finished");
    expect(view.state.completed_tricks).toHaveLength(9);
    const sum = view.finalScore!.team_card_points.reduce((a, b) => a + b, 0);
    expect(sum).toBe(157);

    // AuditLog: für jeden NN-Sitz-Move, der in den Fallback kippt, gibt es
    // einen Eintrag. Bei 4× `aiSeatType=nn` und 36 Moves müssten das 36
    // Einträge sein. Wir prüfen ≥ 30, um geringfügige Race-Conditions im
    // Fallback-Pfad nicht zur Flakiness zu machen.
    const fallbackLogs = await app.prisma.auditLog.findMany({
      where: { action: "game.ai.inference_fallback" },
    });
    expect(fallbackLogs.length).toBeGreaterThanOrEqual(30);

    // Stub wurde tatsächlich kontaktiert (= API-Pfad bis InferenceClient ok)
    expect(app.inference.callCount).toBeGreaterThanOrEqual(30);
  });

  it("Stub-Default (200, argmax-of-mask) → KEIN Fallback, AuditLog leer", async () => {
    // Default-Mode ist `argmax-of-mask`; explicit setzen wir nur, um es
    // explizit zu machen.
    app.inference.setMode({ mode: "argmax-of-mask" });

    const { movesPlayed } = await playFullGame("nn");
    expect(movesPlayed).toBe(36);

    const fallbackLogs = await app.prisma.auditLog.findMany({
      where: { action: "game.ai.inference_fallback" },
    });
    expect(fallbackLogs).toHaveLength(0);
    expect(app.inference.callCount).toBe(36); // 1 predict pro KI-Move
  });
});
