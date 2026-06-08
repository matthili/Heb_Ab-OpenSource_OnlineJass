/**
 * Integration-Test: „Echtes Abheben" (cut the deck).
 *
 * Verifiziert:
 *   1. Folgespiel (announcerSeat bekannt) + cutEnabled → Abheben-Phase
 *      (view.cut gesetzt, Abheber = (announcer+2)%4, noch keine Hand).
 *   2. applyCut → wechselt in die normale Ansage-Phase, Hände ausgeteilt.
 *   3. Falscher Sitz darf nicht abheben.
 *   4. Spiel 1 (WELI, announcerSeat undefined) wird NICHT abgehoben.
 *   5. KI-Abheber: nextAIAction liefert kind "cut"; Voll-Loop läuft durch.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GameService, SeatAssignment } from "../../src/modules/game/game.service.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const AI_SEATS: SeatAssignment[] = [
  { seat: 0, userId: null, aiSeatType: "heuristic" },
  { seat: 1, userId: null, aiSeatType: "heuristic" },
  { seat: 2, userId: null, aiSeatType: "heuristic" },
  { seat: 3, userId: null, aiSeatType: "heuristic" },
];

describe("Echtes Abheben — Flow", () => {
  let app: TestAppHandle;
  let games: GameService;

  beforeAll(async () => {
    app = await setupTestApp();
    games = app.games;
  });

  beforeEach(async () => {
    await app.resetData();
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  it("Folgespiel + cutEnabled → Abheben-Phase, Abheber = (Ansager+2)%4", async () => {
    const { gameId } = await games.createGame({
      seats: AI_SEATS,
      announcerSeat: 1,
      cutEnabled: true,
      rngSeed: 0x1234,
    });
    const view = await games.viewForSeat(gameId, 3);
    expect(view.status).toBe("announcing");
    expect(view.cut).toBeDefined();
    expect(view.cut!.cutterSeat).toBe(3); // (1 + 2) % 4
    expect(view.cut!.iAmCutter).toBe(true);
    expect(view.cut!.deckSize).toBe(36);
    // In der Abheben-Phase ist noch nichts ausgeteilt + keine Ansage offen.
    expect(view.hand).toHaveLength(0);
    expect(view.announcement).toBeUndefined();
    // Aus Sicht eines anderen Sitzes: nicht der Abheber.
    const other = await games.viewForSeat(gameId, 0);
    expect(other.cut!.iAmCutter).toBe(false);
  });

  it("applyCut → wechselt in die Ansage-Phase, Hände sind ausgeteilt", async () => {
    const { gameId } = await games.createGame({
      seats: AI_SEATS,
      announcerSeat: 1,
      cutEnabled: true,
      rngSeed: 0x1234,
    });
    await games.applyCutAsSeat(gameId, 3, 10);
    const view = await games.viewForSeat(gameId, 1);
    expect(view.cut).toBeUndefined();
    expect(view.announcement).toBeDefined();
    expect(view.announcement!.announcerSeat).toBe(1);
    expect(view.hand).toHaveLength(9);
  });

  it("Klopfen (cutIndex 0) teilt ohne Umsortieren aus", async () => {
    const { gameId } = await games.createGame({
      seats: AI_SEATS,
      announcerSeat: 2,
      cutEnabled: true,
      rngSeed: 0x99,
    });
    await games.applyCutAsSeat(gameId, 0, 0); // (2+2)%4 = 0 ist Abheber
    const view = await games.viewForSeat(gameId, 2);
    expect(view.cut).toBeUndefined();
    expect(view.announcement!.announcerSeat).toBe(2);
    expect(view.hand).toHaveLength(9);
  });

  it("falscher Sitz darf nicht abheben", async () => {
    const { gameId } = await games.createGame({
      seats: AI_SEATS,
      announcerSeat: 1,
      cutEnabled: true,
      rngSeed: 0x1234,
    });
    // Abheber ist Sitz 3 — Sitz 0 darf nicht.
    await expect(games.applyCutAsSeat(gameId, 0, 5)).rejects.toThrow();
  });

  it("Spiel 1 wird AUCH abgehoben — nach der WELI-Ansager-Ermittlung", async () => {
    // Kein announcerSeat → Ansager kommt aus der WELI-Ermittlung; danach
    // mischt der Geber neu und es wird trotzdem abgehoben (Vorarlberger Regel:
    // nur die WELI-Ermittlung selbst wird nicht abgehoben).
    const { gameId } = await games.createGame({
      seats: AI_SEATS,
      cutEnabled: true,
      rngSeed: 0x1234,
    });
    const view = await games.viewForSeat(gameId, 0);
    expect(view.cut).toBeDefined();
    expect(view.cut!.cutterSeat).toBeGreaterThanOrEqual(0);
    expect(view.cut!.cutterSeat).toBeLessThan(4);
    expect(view.hand).toHaveLength(0); // noch nicht ausgeteilt

    // Abheben → Ansage-Phase; Abheber muss (Ansager + 2) % 4 sein.
    const cutterSeat = view.cut!.cutterSeat;
    await games.applyCutAsSeat(gameId, cutterSeat, 7);
    const after = await games.viewForSeat(gameId, 0);
    expect(after.cut).toBeUndefined();
    expect(after.announcement).toBeDefined();
    expect((after.announcement!.announcerSeat + 2) % 4).toBe(cutterSeat);
    expect(after.hand).toHaveLength(9);
  });

  it("cutEnabled=false → kein Abheben, direkt Ansage-Phase", async () => {
    const { gameId } = await games.createGame({
      seats: AI_SEATS,
      announcerSeat: 1,
      cutEnabled: false,
      rngSeed: 0x1234,
    });
    const view = await games.viewForSeat(gameId, 1);
    expect(view.cut).toBeUndefined();
    expect(view.announcement).toBeDefined();
  });

  it("KI-Abheber + Voll-Loop: cut → announce → moves bis Spielende", async () => {
    const { gameId } = await games.createGame({
      seats: AI_SEATS,
      announcerSeat: 1,
      cutEnabled: true,
      rngSeed: 0x2222,
    });
    // Erster KI-Schritt ist das Abheben.
    const first = await games.nextAIAction(gameId);
    expect(first?.kind).toBe("cut");
    expect(first?.seat).toBe(3);

    // Loop wie das Gateway: cut → announce → move …
    let cutSteps = 0;
    let announceSteps = 0;
    for (let i = 0; i < 60; i++) {
      const action = await games.nextAIAction(gameId);
      if (!action) break;
      if (action.kind === "cut") {
        cutSteps++;
        await games.applyCutAsSeat(gameId, action.seat, 1 + (i % 35));
      } else if (action.kind === "announce") {
        announceSteps++;
        const decision = await games.aiChooseAnnouncement(gameId, action.seat);
        await games.applyAnnouncementAsSeat(gameId, action.seat, decision);
      } else {
        const card = await games.aiChooseMove(gameId, action.seat, action.aiSeatType);
        await games.playMoveAsSeat(gameId, action.seat, card);
      }
    }
    expect(cutSteps).toBe(1); // genau einmal abgehoben
    expect(announceSteps).toBeGreaterThanOrEqual(1);

    const finalView = await games.viewForSeat(gameId, 1);
    expect(finalView.status).toBe("finished");
    expect(finalView.finalScore).toBeDefined();
  });
});
