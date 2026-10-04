/**
 * `GameGateway.driveAIsLoop` — Stöck-Auto-Ansage der KI.
 *
 * Ruft eine KI nach ihrem Zug Stöck, müssen Zug und Stöck in EINEM
 * `game:state` ankommen. Vorher gingen zwei Broadcasts hintereinander raus;
 * war der nächste Sitz ein Mensch, bekam er zweimal myTurn für denselben Zug.
 * Gemessen im game-ws-Integrationstest: 4 von 80 Spielen → der Testclient
 * spielte dieselbe Karte doppelt („Card … not in hand").
 *
 * Der Gateway wird hier mit Stubs gebaut; geprüft wird nur die Reihenfolge
 * der Schritte im KI-Loop (Kreuz und Solo teilen ihn, Bodensee kennt keinen
 * Stöck).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GameGateway } from "../src/modules/game/game.gateway.js";

describe("GameGateway.driveAIsLoop — Stöck", () => {
  const previousDelay = process.env["AI_STEP_DELAY_MS"];
  beforeAll(() => {
    process.env["AI_STEP_DELAY_MS"] = "0";
  });
  afterAll(() => {
    if (previousDelay === undefined) delete process.env["AI_STEP_DELAY_MS"];
    else process.env["AI_STEP_DELAY_MS"] = previousDelay;
  });

  function build(stoeckEligible: boolean) {
    const timeline: string[] = [];
    const emitted: { stoeckAnnouncedTeam: number | null }[] = [];
    let stoeckTeam: number | null = null;
    let aiTurns = 1;

    const games = {
      nextAIAction: async () =>
        aiTurns-- > 0 ? { kind: "move", seat: 3, aiSeatType: "random" } : null,
      aiAutoWeisenForSeat: async () => {
        timeline.push("weisen");
      },
      aiChooseMove: async () => ({ suit: "EICHEL", rank: "OBER" }),
      playMoveAsSeat: async () => {
        timeline.push("zug");
        return { view: { stoeckEligible, status: "playing" } };
      },
      announceStoeckAsSeat: async () => {
        timeline.push("stoeck");
        stoeckTeam = 1;
      },
      viewForUser: async () => ({ myTurn: true, stoeckAnnouncedTeam: stoeckTeam }),
    };
    const humanSocket = {
      data: { userId: "mensch" },
      emit: (event: string, payload: { stoeckAnnouncedTeam: number | null }) => {
        if (event !== "game:state") return false;
        timeline.push("state");
        emitted.push(payload);
        return true;
      },
    };
    const server = {
      in: () => ({ fetchSockets: async () => [humanSocket] }),
      to: () => ({ emit: () => true }),
    };

    const stub = {} as never;
    const gateway = new GameGateway(
      games as never,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub
    );
    (gateway as unknown as { server: unknown }).server = server;
    const drive = () =>
      (gateway as unknown as { driveAIsLoop(gameId: string): Promise<void> }).driveAIsLoop("g1");
    return { drive, timeline, emitted };
  }

  it("sagt Stöck vor dem Broadcast an — ein game:state für Zug + Stöck", async () => {
    const { drive, timeline, emitted } = build(true);
    await drive();

    expect(timeline.slice(timeline.indexOf("zug"))).toEqual(["zug", "stoeck", "state"]);
    expect(emitted.at(-1)?.stoeckAnnouncedTeam).toBe(1);
  });

  it("ohne Stöck-Berechtigung: Zug, dann genau ein game:state", async () => {
    const { drive, timeline } = build(false);
    await drive();

    expect(timeline.slice(timeline.indexOf("zug"))).toEqual(["zug", "state"]);
  });
});
