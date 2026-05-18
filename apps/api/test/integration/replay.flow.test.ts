/**
 * Integration-Test M10-A: Replay-Bundle eines durchgespielten 4-Bot-Games.
 *
 * Wir spielen eine Partie zu Ende, lesen das Replay-Bundle, und prüfen:
 *   - 36 Moves in seq-Reihenfolge
 *   - Initial-Hand pro Sitz lässt sich aus Moves rekonstruieren (9 Karten,
 *     keine Doppler über alle Sitze hinweg = 36 unique cardIndex-Werte)
 *   - Round-Decision passt zur ursprünglichen Ansage
 *   - Authorization: Teilnehmer sieht Replay, Nicht-Teilnehmer kriegt 403
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GameService, SeatAssignment } from "../../src/modules/game/game.service.js";
import type { ReplayService } from "../../src/modules/game/replay.service.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("M10-A replay — Bundle eines beendeten 4-Bot-Spiels", () => {
  let app: TestAppHandle;
  let games: GameService;
  let replay: ReplayService;

  beforeAll(async () => {
    app = await setupTestApp();
    games = app.games;
    replay = app.replay;
  });

  beforeEach(async () => {
    await app.resetData();
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  it("Bundle enthält 36 Moves, 4 Sitze, Round-Decision, FinalScore", async () => {
    // Test-User anlegen, damit wir Sitz 0 als „menschlich" haben und die
    // Authorization-Pfade durchtesten können.
    const me = await app.prisma.user.create({
      data: {
        email: "replay-test@example.com",
        name: "Replay Tester",
        emailVerified: true,
      },
    });
    const stranger = await app.prisma.user.create({
      data: {
        email: "stranger@example.com",
        name: "Fremder",
        emailVerified: true,
      },
    });

    const seats: SeatAssignment[] = [
      { seat: 0, userId: me.id, aiSeatType: null },
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
      rngSeed: 0xdecafbad,
    });

    // Bots spielen die Partie durch. Sitz 0 (User) müssen wir auch via
    // playMoveAsSeat treiben, weil wir das Gateway nicht starten — wir
    // schicken einfach jeden Zug, bis kein KI-Sitz mehr dran ist.
    for (let i = 0; i < 50; i++) {
      const view = await games.viewForSeat(gameId, 0);
      if (view.status === "finished") break;
      const next = await games.nextAISeat(gameId);
      if (next) {
        const card = await games.aiChooseMove(gameId, next.seat, next.aiSeatType);
        await games.playMoveAsSeat(gameId, next.seat, card);
      } else {
        // Sitz 0 ist dran (User). Wir spielen die erste legale Karte.
        const myView = await games.viewForSeat(gameId, 0);
        const idx = myView.legalActionMask.findIndex((b) => b === 1);
        expect(idx).toBeGreaterThanOrEqual(0);
        await games.playMoveAsUser(
          gameId,
          me.id,
          myView.hand[
            myView.hand.findIndex(
              (c) =>
                ["EICHEL", "SCHELLE", "HERZ", "LAUB"].indexOf(c.suit) * 9 +
                  [
                    "SECHS",
                    "SIEBEN",
                    "ACHT",
                    "NEUN",
                    "ZEHN",
                    "UNTER",
                    "OBER",
                    "KOENIG",
                    "ASS",
                  ].indexOf(c.rank) ===
                idx
            )
          ]!
        );
      }
    }

    // ─── Bundle holen ────────────────────────────────────────────────
    const bundle = await replay.getReplay(gameId, me.id);
    expect(bundle.gameId).toBe(gameId);
    expect(bundle.status).toBe("finished");
    expect(bundle.moves).toHaveLength(36);
    expect(bundle.seats).toHaveLength(4);
    expect(bundle.seats[0]?.userId).toBe(me.id);
    expect(bundle.seats[0]?.aiSeatType).toBeNull();
    expect(bundle.rounds).toHaveLength(1);
    expect(bundle.rounds[0]?.mode).toBe("TRUMPF");
    expect(bundle.rounds[0]?.starter).toBe(0);

    // Moves sind aufsteigend nach seq (1..36).
    const seqs = bundle.moves.map((m) => m.seq);
    expect(seqs).toEqual([...Array(36).keys()].map((i) => i + 1));

    // Initial-Hand-Rekonstruktion: jeder Sitz hat 9 Karten gespielt, alle
    // 36 cardIndex-Werte sind unique.
    const cardCountsPerSeat = [0, 0, 0, 0];
    const allCardIndices = new Set<number>();
    for (const m of bundle.moves) {
      cardCountsPerSeat[m.seat]! += 1;
      allCardIndices.add(m.cardIndex);
    }
    expect(cardCountsPerSeat).toEqual([9, 9, 9, 9]);
    expect(allCardIndices.size).toBe(36);

    expect(bundle.finalScore).not.toBeNull();
    expect(bundle.finalScore!.team_card_points).toHaveLength(2);

    // ─── Authorization ──────────────────────────────────────────────
    await expect(replay.getReplay(gameId, stranger.id)).rejects.toThrow(/nur für Teilnehmer/i);

    // Admins dürfen rein.
    await app.prisma.user.update({ where: { id: stranger.id }, data: { role: "ADMIN" } });
    const adminView = await replay.getReplay(gameId, stranger.id);
    expect(adminView.gameId).toBe(gameId);
  });

  it("listUserGames liefert eigene Spiele in Reihenfolge", async () => {
    const me = await app.prisma.user.create({
      data: { email: "p1@example.com", name: "P1", emailVerified: true },
    });
    const other = await app.prisma.user.create({
      data: { email: "p2@example.com", name: "P2", emailVerified: true },
    });

    // 2 Games: eins mit `me`, eins ohne. Nur das erste sollte gelistet werden.
    const variant = { mode: "TRUMPF" as const, trump_suit: "EICHEL" as const };
    const annoucement = { variant, slalom: false };

    const { gameId: gMine } = await games.createGame({
      variant,
      announcement: annoucement,
      starter: 0,
      seats: [
        { seat: 0, userId: me.id, aiSeatType: null },
        { seat: 1, userId: null, aiSeatType: "random" },
        { seat: 2, userId: null, aiSeatType: "random" },
        { seat: 3, userId: null, aiSeatType: "random" },
      ],
      rngSeed: 1,
    });

    await games.createGame({
      variant,
      announcement: annoucement,
      starter: 0,
      seats: [
        { seat: 0, userId: other.id, aiSeatType: null },
        { seat: 1, userId: null, aiSeatType: "random" },
        { seat: 2, userId: null, aiSeatType: "random" },
        { seat: 3, userId: null, aiSeatType: "random" },
      ],
      rngSeed: 2,
    });

    const list = await replay.listUserGames(me.id, 50, 0);
    expect(list).toHaveLength(1);
    expect(list[0]?.gameId).toBe(gMine);
    expect(list[0]?.mySeat).toBe(0);
    expect(list[0]?.myTeam).toBe(0);
  });
});
