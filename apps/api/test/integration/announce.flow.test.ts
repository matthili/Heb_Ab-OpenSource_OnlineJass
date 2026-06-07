/**
 * Integration-Test Sprint C: Trumpf-Ansage-Flow.
 *
 * Wir testen drei Pfade:
 *   1. 4 Heuristik-KIs: Game startet im announcing-Modus, KI sagt an,
 *      Spiel läuft durch bis 36 Moves. Verifikation: kein PENDING-State
 *      in der DB nach Game-Ende, Final-Score korrekt.
 *   2. Push-Pfad: Original-Announcer schiebt, Partner sagt an.
 *   3. Validation: ungültige Ansage (TRUMPF ohne trumpSuit) wirft Error.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GameService, SeatAssignment } from "../../src/modules/game/game.service.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("Sprint C — Trumpf-Ansage-Flow", () => {
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

  it("4 Heuristik-KIs: Ansage + Game-Loop laufen durch", async () => {
    const seats: SeatAssignment[] = [
      { seat: 0, userId: null, aiSeatType: "heuristic" },
      { seat: 1, userId: null, aiSeatType: "heuristic" },
      { seat: 2, userId: null, aiSeatType: "heuristic" },
      { seat: 3, userId: null, aiSeatType: "heuristic" },
    ];
    // Ohne Variant → announcing-Modus
    const { gameId } = await games.createGame({
      seats,
      rngSeed: 0x42424242,
    });

    // Initial-View: announcing
    const view0 = await games.viewForSeat(gameId, 0);
    expect(view0.status).toBe("announcing");
    expect(view0.state).toBeNull();
    expect(view0.announcement).toBeDefined();
    expect(view0.announcement!.announcerSeat).toBeGreaterThanOrEqual(0);
    expect(view0.announcement!.announcerSeat).toBeLessThan(4);

    // KI-Loop simulieren — Game-Gateway macht das via driveAIsLoop.
    // Wir treiben es hier direkt über die Service-API.
    let announceSteps = 0;
    for (let i = 0; i < 40; i++) {
      const action = await games.nextAIAction(gameId);
      if (!action) break;
      if (action.kind === "announce") {
        announceSteps++;
        const decision = await games.aiChooseAnnouncement(gameId, action.seat);
        await games.applyAnnouncementAsSeat(gameId, action.seat, decision);
      } else {
        const card = await games.aiChooseMove(gameId, action.seat, action.aiSeatType);
        await games.playMoveAsSeat(gameId, action.seat, card);
      }
    }
    expect(announceSteps).toBeGreaterThanOrEqual(1); // mindestens eine Ansage
    expect(announceSteps).toBeLessThanOrEqual(2); // Original + max 1 Push

    // Spiel sollte abgeschlossen sein
    const finalView = await games.viewForSeat(gameId, 0);
    expect(finalView.status).toBe("finished");
    expect(finalView.state).not.toBeNull();
    expect(finalView.state!.completed_tricks).toHaveLength(9);
    expect(finalView.finalScore).toBeDefined();
    expect(finalView.finalScore!.team_card_points).toHaveLength(2);
    const sum = finalView.finalScore!.team_card_points.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(157); // 157 ohne Matsch, 257 mit

    // RoundDecision wurde aus PENDING auf konkrete Variante upgedatet.
    const rd = await app.prisma.roundDecision.findUnique({
      where: { gameId_roundIdx: { gameId, roundIdx: 0 } },
    });
    expect(rd?.mode).not.toBe("PENDING");
    expect(["TRUMPF", "GUMPF", "OBEN", "UNTEN"]).toContain(rd?.mode);
  });

  it("Push-Pfad: applyAnnouncementAsSeat schiebt, Partner übernimmt", async () => {
    const seats: SeatAssignment[] = [
      { seat: 0, userId: null, aiSeatType: "heuristic" },
      { seat: 1, userId: null, aiSeatType: "heuristic" },
      { seat: 2, userId: null, aiSeatType: "heuristic" },
      { seat: 3, userId: null, aiSeatType: "heuristic" },
    ];
    const { gameId } = await games.createGame({
      seats,
      announcerSeat: 0, // explizit Sitz 0 als Ansager
      rngSeed: 1,
    });

    // Push-Decision senden
    await games.applyAnnouncementAsSeat(gameId, 0, { kind: "push" });

    // Nach Push: Sitz 2 (Partner) ist Announcer, pushedFromSeat=0
    const view = await games.viewForSeat(gameId, 2);
    expect(view.status).toBe("announcing");
    expect(view.announcement?.announcerSeat).toBe(2);
    expect(view.announcement?.pushedFromSeat).toBe(0);
    expect(view.announcement?.canPush).toBe(false); // Partner darf nicht zurück

    // Doppel-Push muss scheitern
    await expect(games.applyAnnouncementAsSeat(gameId, 2, { kind: "push" })).rejects.toThrow(
      /Partner hat schon übernommen/i
    );

    // Partner sagt jetzt OBEN an
    await games.applyAnnouncementAsSeat(gameId, 2, { kind: "announce", mode: "OBEN" });

    // Starter ist der ORIGINAL-Ansager (Sitz 0), nicht Sitz 2
    const rd = await app.prisma.roundDecision.findUnique({
      where: { gameId_roundIdx: { gameId, roundIdx: 0 } },
    });
    expect(rd?.mode).toBe("OBEN");
    expect(rd?.starter).toBe(0);
  });

  it("Schiebe-Slalom: der Schieber (Vorhand) wählt die Start-Richtung, nicht der Ansager", async () => {
    const seats: SeatAssignment[] = [
      { seat: 0, userId: null, aiSeatType: "heuristic" },
      { seat: 1, userId: null, aiSeatType: "heuristic" },
      { seat: 2, userId: null, aiSeatType: "heuristic" },
      { seat: 3, userId: null, aiSeatType: "heuristic" },
    ];
    const { gameId } = await games.createGame({ seats, announcerSeat: 0, rngSeed: 7 });

    // Sitz 0 schiebt → Partner (Sitz 2) wird Ansager.
    await games.applyAnnouncementAsSeat(gameId, 0, { kind: "push" });

    // Partner sagt SLALOM an — Startmodus OBEN wird mitgeschickt, MUSS aber
    // verworfen werden (der Schieber entscheidet).
    await games.applyAnnouncementAsSeat(gameId, 2, {
      kind: "announce",
      mode: "OBEN",
      slalom: true,
    });

    // Die Richtungs-Wahl wandert zurück an den Schieber (Sitz 0).
    const dirView = await games.viewForSeat(gameId, 0);
    expect(dirView.status).toBe("announcing");
    expect(dirView.announcement?.announcerSeat).toBe(0);
    expect(dirView.announcement?.slalomDirectionOnly).toBe(true);
    expect(dirView.announcement?.canPush).toBe(false);

    // Im Richtungs-Schritt ist Schieben gesperrt.
    await expect(games.applyAnnouncementAsSeat(gameId, 0, { kind: "push" })).rejects.toThrow();

    // Der Schieber wählt UNTEN (≠ OBEN-Default des Partners) → Runde startet.
    await games.applyAnnouncementAsSeat(gameId, 0, {
      kind: "announce",
      mode: "UNTEN",
      slalom: true,
    });

    const rd = await app.prisma.roundDecision.findUnique({
      where: { gameId_roundIdx: { gameId, roundIdx: 0 } },
    });
    expect(rd?.starter).toBe(0); // Schieber kommt raus
    expect(rd?.mode).toBe("UNTEN"); // Richtung vom Schieber, nicht OBEN vom Partner

    const playView = await games.viewForSeat(gameId, 0);
    expect(playView.status).toBe("playing");
    expect(playView.state?.announcement.slalom).toBe(true); // es IST ein Slalom
  });

  it("Validation: TRUMPF ohne trumpSuit wirft", async () => {
    const seats: SeatAssignment[] = [
      { seat: 0, userId: null, aiSeatType: "heuristic" },
      { seat: 1, userId: null, aiSeatType: "heuristic" },
      { seat: 2, userId: null, aiSeatType: "heuristic" },
      { seat: 3, userId: null, aiSeatType: "heuristic" },
    ];
    const { gameId } = await games.createGame({
      seats,
      announcerSeat: 0,
      rngSeed: 2,
    });
    await expect(
      games.applyAnnouncementAsSeat(gameId, 0, { kind: "announce", mode: "TRUMPF" })
    ).rejects.toThrow(/trumpSuit/i);
    await expect(
      games.applyAnnouncementAsSeat(gameId, 0, {
        kind: "announce",
        mode: "OBEN",
        trumpSuit: "EICHEL",
      })
    ).rejects.toThrow(/darf keinen trumpSuit haben/i);
  });

  it("WELI-Inhaber wird Default-Announcer bei Spiel 1", async () => {
    // Wir nutzen die public Card-API um eine deterministische Hand zu
    // bauen, in der Sitz 2 das WELI hat. Da `dealCards` aber zufällig
    // ist, geben wir explizite `hands` mit.
    const fullDeck: { suit: "EICHEL" | "SCHELLE" | "HERZ" | "LAUB"; rank: string }[] = [];
    for (const s of ["EICHEL", "SCHELLE", "HERZ", "LAUB"] as const) {
      for (const r of [
        "SECHS",
        "SIEBEN",
        "ACHT",
        "NEUN",
        "ZEHN",
        "UNTER",
        "OBER",
        "KOENIG",
        "ASS",
      ]) {
        fullDeck.push({ suit: s, rank: r });
      }
    }
    // 36 Karten, WELI ist Schelle-Sechs (Index 9).
    // Wir bauen 4 Hände à 9 Karten und stecken den WELI in Hand 2.
    const weli = fullDeck[9]!; // schelle-sechs
    const rest = fullDeck.filter((_, i) => i !== 9);
    const hands: { suit: typeof weli.suit; rank: string }[][] = [
      rest.slice(0, 9),
      rest.slice(9, 18),
      rest.slice(18, 26).concat(weli), // Sitz 2 bekommt das WELI als 9. Karte
      rest.slice(26, 35),
    ];

    const seats: SeatAssignment[] = [
      { seat: 0, userId: null, aiSeatType: "heuristic" },
      { seat: 1, userId: null, aiSeatType: "heuristic" },
      { seat: 2, userId: null, aiSeatType: "heuristic" },
      { seat: 3, userId: null, aiSeatType: "heuristic" },
    ];

    const { gameId } = await games.createGame({
      seats,
      hands: hands as never,
    });

    const view = await games.viewForSeat(gameId, 2);
    expect(view.announcement?.announcerSeat).toBe(2);
  });
});
