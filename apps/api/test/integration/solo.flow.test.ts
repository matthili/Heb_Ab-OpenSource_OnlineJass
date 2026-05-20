/**
 * Integration-Test: Solo-Jass (v0.8.0-Sprint).
 *
 * Solo-Jass = 4 Spieler, jeder gegen jeden (teams=[0,1,2,3]), kein
 * Schieben. Wir verifizieren über die `GameService`-API (ohne WS):
 *
 *   - createGame mit gameType="solo" legt ein SOLO_4P-Game an
 *   - der RoundState trägt teams=[0,1,2,3]
 *   - ein komplettes Solo-Spiel läuft mit 4 KIs durch (36 Moves)
 *   - finalScore hat 4 separate Konten, Summe stimmt
 *   - im Ansage-Modus ist Schieben verboten (BadRequest)
 *
 * Kreuz-Jass bleibt unberührt (Default-gameType).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GameService, SeatAssignment } from "../../src/modules/game/game.service.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("Solo-Jass — Game-Loop + Regeln", () => {
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

  it("createGame(gameType=solo) → SOLO_4P-Game, teams=[0,1,2,3]", async () => {
    const variant = { mode: "TRUMPF" as const, trump_suit: "EICHEL" as const };
    const { gameId } = await games.createGame({
      variant,
      announcement: { variant, slalom: false },
      starter: 0,
      gameType: "solo",
      seats: [
        { seat: 0, userId: null, aiSeatType: "heuristic" },
        { seat: 1, userId: null, aiSeatType: "heuristic" },
        { seat: 2, userId: null, aiSeatType: "heuristic" },
        { seat: 3, userId: null, aiSeatType: "heuristic" },
      ] as SeatAssignment[],
      rngSeed: 0x50_10,
    });

    // DB-Variante muss SOLO_4P sein.
    const game = await app.prisma.game.findUnique({ where: { id: gameId } });
    expect(game?.variant).toBe("SOLO_4P");

    // RoundState: jeder Sitz ein eigenes Team.
    const view = await games.viewForSeat(gameId, 0);
    expect(view.state?.teams).toEqual([0, 1, 2, 3]);
    // Volles Punkte-Array mit 4 Konten.
    expect(view.state?.team_card_points).toHaveLength(4);
  });

  it("4 KIs spielen eine Solo-Runde durch — 36 Moves, 4 Konten, Summe 157/257", async () => {
    const variant = { mode: "TRUMPF" as const, trump_suit: "HERZ" as const };
    const { gameId } = await games.createGame({
      variant,
      announcement: { variant, slalom: false },
      starter: 0,
      gameType: "solo",
      seats: [
        { seat: 0, userId: null, aiSeatType: "heuristic" },
        { seat: 1, userId: null, aiSeatType: "heuristic" },
        { seat: 2, userId: null, aiSeatType: "heuristic" },
        { seat: 3, userId: null, aiSeatType: "heuristic" },
      ] as SeatAssignment[],
      rngSeed: 0x50_11,
    });

    let moves = 0;
    for (let i = 0; i < 50; i++) {
      const next = await games.nextAISeat(gameId);
      if (!next) break;
      const card = await games.aiChooseMove(gameId, next.seat, next.aiSeatType);
      await games.playMoveAsSeat(gameId, next.seat, card);
      moves++;
    }
    expect(moves).toBe(36);

    const final = await games.viewForSeat(gameId, 0);
    expect(final.status).toBe("finished");
    const score = final.finalScore!;
    // Vier Einzelkonten — nicht zwei Team-Konten.
    expect(score.team_card_points).toHaveLength(4);
    const sum = score.team_card_points.reduce((a, b) => a + b, 0);
    // 157 normal; +100 falls ein Spieler alle 9 Stiche macht (Matsch).
    expect([157, 257]).toContain(sum);

    // Move-Persistenz wie bei Kreuz.
    const dbMoves = await app.prisma.move.findMany({ where: { gameId } });
    expect(dbMoves).toHaveLength(36);
  });

  it("Schieben im Solo-Ansage-Modus → BadRequest", async () => {
    // Ansage-Modus: createGame ohne `variant`.
    const { gameId } = await games.createGame({
      gameType: "solo",
      seats: [
        { seat: 0, userId: null, aiSeatType: "heuristic" },
        { seat: 1, userId: null, aiSeatType: "heuristic" },
        { seat: 2, userId: null, aiSeatType: "heuristic" },
        { seat: 3, userId: null, aiSeatType: "heuristic" },
      ] as SeatAssignment[],
      rngSeed: 0x50_12,
    });

    const view = await games.viewForSeat(gameId, 0);
    expect(view.status).toBe("announcing");
    // canPush ist im Solo immer false.
    expect(view.announcement?.canPush).toBe(false);

    // Push-Versuch am aktuellen Announcer → BadRequest.
    const announcer = view.announcement!.announcerSeat;
    await expect(
      games.applyAnnouncementAsSeat(gameId, announcer, { kind: "push" })
    ).rejects.toThrow(/Solo-Jass/);
  });
});
