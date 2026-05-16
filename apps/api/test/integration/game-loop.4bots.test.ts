/**
 * Integration-Test: M4-Done-when — „4-Bot-Game-Loop deterministisch".
 *
 * Wir umgehen hier bewusst das WebSocket-Gateway und treiben die KI-Schleife
 * direkt über die `GameService`-API. Das isoliert den Service-Layer:
 *   - kein Cookie/Auth-Setup
 *   - kein Socket.IO-Handshake
 *   - Spiel deterministisch via `rngSeed`
 * Der Gateway-Pfad (WS + Auto-Step + Per-Sitz-Broadcasts) ist Sache von
 * `game-ws.user-vs-bots.test.ts`.
 *
 * Was wir verifizieren:
 *   - createGame mit 4× `userId: null, aiSeatType: "random"` ist akzeptiert
 *   - Die Loop läuft 36 Moves (9 Tricks × 4 Sitze) ohne InvalidMove-Error
 *   - Punktesumme aller Tricks ist 157 (= 152 Karten-Punkte + 5
 *     Letzter-Stich-Bonus, kein Matsch)
 *   - Hände aller Sitze sind am Ende leer
 *   - finalScore.team_card_points hat zwei Einträge (Team 0 + Team 1)
 *
 * Performance: ~250 ms pro Run (Service-direkt ohne WS-Roundtrips), läuft in
 * der gleichen Vitest-Worker-Instanz wie der Auth-Test → keine zusätzliche
 * Container-Boot-Zeit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GameService, SeatAssignment } from "../../src/modules/game/game.service.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("M4 game-loop — 4 Random-KIs spielen eine Runde durch", () => {
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

  it("36 Moves, 9 Tricks, Punktesumme 157, leere Hände", async () => {
    const seats: SeatAssignment[] = [
      { seat: 0, userId: null, aiSeatType: "random" },
      { seat: 1, userId: null, aiSeatType: "random" },
      { seat: 2, userId: null, aiSeatType: "random" },
      { seat: 3, userId: null, aiSeatType: "random" },
    ];
    const variant = { mode: "TRUMPF" as const, trump_suit: "EICHEL" as const };
    const { gameId } = await games.createGame({
      variant,
      announcement: { variant, slalom: false },
      starter: 0,
      seats,
      rngSeed: 0xc0ffee, // Karten-Verteilung deterministisch (Player-Wahl nicht)
    });

    // KI-Schritte ausführen bis kein KI-Sitz mehr dran ist.
    let movesPlayed = 0;
    for (let i = 0; i < 50; i++) {
      const next = await games.nextAISeat(gameId);
      if (!next) break;
      const card = await games.aiChooseMove(gameId, next.seat, next.aiSeatType);
      await games.playMoveAsSeat(gameId, next.seat, card);
      movesPlayed++;
    }

    expect(movesPlayed).toBe(36); // 9 Tricks × 4 Sitze

    // ─── Verifikation aus Sicht jedes Sitzes ────────────────────────────
    const finalView = await games.viewForSeat(gameId, 0);
    expect(finalView.status).toBe("finished");
    expect(finalView.state.completed_tricks).toHaveLength(9);
    expect(finalView.state.trick_idx).toBe(9);
    expect(finalView.hand).toHaveLength(0);
    expect(finalView.finalScore).toBeDefined();

    const score = finalView.finalScore!;
    expect(score.team_card_points).toHaveLength(2);
    const sum = score.team_card_points.reduce((a, b) => a + b, 0);
    expect(sum).toBe(157);
    expect(score.trick_winners).toHaveLength(9);

    // Auch von Sitz 2 (gegenüberliegendes Team) muss das fertig sein.
    const otherView = await games.viewForSeat(gameId, 2);
    expect(otherView.status).toBe("finished");
    expect(otherView.hand).toHaveLength(0);

    // ─── Persistenz: Moves in DB ───────────────────────────────────────
    const dbMoves = await app.prisma.move.findMany({
      where: { gameId },
      orderBy: { seq: "asc" },
    });
    expect(dbMoves).toHaveLength(36);
    expect(dbMoves[0]?.trickIdx).toBe(0);
    expect(dbMoves[35]?.trickIdx).toBe(8);
    // Jeder Move ohne userId → KI
    expect(dbMoves.every((m) => m.userId === null)).toBe(true);
  });

  it("rngSeed reproduziert die Eröffnungs-Hand des eigenen Sitzes", async () => {
    // Das deterministische Mischen testen — wir vergleichen die anfängliche
    // Hand des eigenen Sitzes nach `createGame`, vor irgendeinem Move.
    // `PlayerView.state` filtert die fremden Hände raus; deshalb prüfen wir
    // `view.hand` (die eigene), die für deterministischen Seed identisch sein
    // muss. Die Wahl der `random`-KI selbst ist nicht-deterministisch
    // (`Math.random`), daher prüfen wir VOR dem ersten KI-Move.
    const variant = { mode: "TRUMPF" as const, trump_suit: "HERZ" as const };
    const opts = {
      variant,
      announcement: { variant, slalom: false },
      starter: 1,
      seats: [
        { seat: 0, userId: null, aiSeatType: "random" },
        { seat: 1, userId: null, aiSeatType: "random" },
        { seat: 2, userId: null, aiSeatType: "random" },
        { seat: 3, userId: null, aiSeatType: "random" },
      ] as SeatAssignment[],
      rngSeed: 42,
    };
    const first = await games.createGame(opts);
    const firstHand = (await games.viewForSeat(first.gameId, 0)).hand;

    await app.resetData();
    const second = await games.createGame(opts);
    const secondHand = (await games.viewForSeat(second.gameId, 0)).hand;

    expect(secondHand).toEqual(firstHand);
    expect(firstHand).toHaveLength(9); // jeder Sitz bekommt 9 Karten
  });
});
