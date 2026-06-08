/**
 * Tests für die optionalen Tisch-Wertungsregeln in `finalRoundScore`:
 *   - „kein Stich → Weis verfällt" (`weis_needs_trick`)
 *   - „Sack" (`sack_rule`): < 21 reine Kartenpunkte → alles verfällt
 *
 * Strategie: wir bauen synthetisch einen *fertigen* RoundState (9 Dummy-
 * Tricks → `isRoundDone` true) und setzen nur die Felder, die
 * `finalRoundScore` tatsächlich liest: `trick_winners`, `team_card_points`
 * (bereits inkl. Weis), `weisen_team_points` (reiner Weis-Anteil), die zwei
 * Regel-Flags sowie `stoeck_announced_team`.
 */
import { describe, expect, it } from "vitest";

import { dealCards, finalRoundScore, newRound, type RoundState } from "../src/state.js";
import type { Card } from "../src/types.js";

function seededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function finished(opts: {
  teams: readonly number[];
  trickWinners: readonly number[]; // Länge 9, Sitz pro Stich
  teamCardPoints: readonly number[]; // merged (Karten + Weis)
  weisTeamPoints?: readonly number[];
  sackRule?: boolean;
  weisNeedsTrick?: boolean;
  stoeckTeam?: number | null;
}): RoundState {
  const base = newRound({
    variant: { mode: "OBEN" },
    announcement: { variant: { mode: "OBEN" }, slalom: false },
    hands: dealCards(seededRng(7)),
    starter: 0,
    teams: opts.teams,
  });
  const dummyTrick = { starter: 0, cards: [] as Card[] };
  return {
    ...base,
    completed_tricks: Array.from({ length: 9 }, () => dummyTrick),
    trick_winners: opts.trickWinners,
    team_card_points: opts.teamCardPoints,
    weisen_team_points: opts.weisTeamPoints ?? opts.teamCardPoints.map(() => 0),
    sack_rule: opts.sackRule ?? false,
    weis_needs_trick: opts.weisNeedsTrick ?? false,
    stoeck_announced_team: opts.stoeckTeam ?? null,
  };
}

describe("finalRoundScore: ohne optionale Regeln (Baseline unverändert)", () => {
  it("Kreuz: Punkte bleiben wie geführt", () => {
    const s = finished({
      teams: [0, 1, 0, 1],
      trickWinners: [0, 0, 0, 0, 0, 1, 1, 1, 1], // team0: 5, team1: 4 Stiche
      teamCardPoints: [100, 57],
    });
    expect(finalRoundScore(s).team_card_points).toEqual([100, 57]);
  });
});

describe("Regel Sack (sack_rule): < 21 Kartenpunkte -> alles verfaellt", () => {
  it("Team unter 21 bekommt 0, Punkte gehen an NIEMANDEN (kein Transfer)", () => {
    const s = finished({
      teams: [0, 1, 0, 1],
      trickWinners: [0, 0, 0, 0, 0, 0, 0, 1, 1], // team1 nur 2 Stiche
      teamCardPoints: [140, 17],
      sackRule: true,
    });
    // team1 (17 < 21) verfällt; team0 behält 140 (kein +17).
    expect(finalRoundScore(s).team_card_points).toEqual([140, 0]);
  });

  it("auch der Weis verfällt, wenn die Kartenpunkte unter 21 liegen", () => {
    const s = finished({
      teams: [0, 1, 0, 1],
      trickWinners: [0, 0, 0, 0, 0, 0, 0, 0, 1], // team1: 1 Stich
      teamCardPoints: [147, 60], // team1: 10 Karten + 50 Weis
      weisTeamPoints: [0, 50],
      sackRule: true,
    });
    // cardOnly team1 = 60 - 50 = 10 < 21 → alles (inkl. Weis) weg.
    expect(finalRoundScore(s).team_card_points).toEqual([147, 0]);
  });

  it("Solo: jeder Spieler unter 21 verfällt einzeln", () => {
    const s = finished({
      teams: [0, 1, 2, 3],
      trickWinners: [0, 0, 0, 1, 1, 1, 2, 3, 3],
      teamCardPoints: [80, 60, 12, 5],
      sackRule: true,
    });
    expect(finalRoundScore(s).team_card_points).toEqual([80, 60, 0, 0]);
  });
});

describe("Regel kein Stich -> Weis verfaellt (weis_needs_trick)", () => {
  it("Solo: Spieler mit 0 Stichen verliert seinen Weis", () => {
    const s = finished({
      teams: [0, 1, 2, 3],
      trickWinners: [0, 1, 2, 0, 1, 2, 0, 1, 2], // Sitz 3 = 0 Stiche
      teamCardPoints: [50, 50, 57, 50], // Sitz 3: 50 = nur Weis
      weisTeamPoints: [0, 0, 0, 50],
      weisNeedsTrick: true,
    });
    expect(finalRoundScore(s).team_card_points).toEqual([50, 50, 57, 0]);
  });

  it("ohne die Regel bleibt der Weis trotz 0 Stiche erhalten", () => {
    const s = finished({
      teams: [0, 1, 2, 3],
      trickWinners: [0, 1, 2, 0, 1, 2, 0, 1, 2],
      teamCardPoints: [50, 50, 57, 50],
      weisTeamPoints: [0, 0, 0, 50],
      weisNeedsTrick: false,
    });
    expect(finalRoundScore(s).team_card_points).toEqual([50, 50, 57, 50]);
  });

  it("Kreuz: Weis ohne Stich (Gegner matscht) verfällt + Matsch-Bonus bleibt", () => {
    const s = finished({
      teams: [0, 1, 0, 1],
      trickWinners: [0, 2, 0, 2, 0, 2, 0, 2, 0], // team0: alle 9 → Matsch
      teamCardPoints: [157, 50], // team1: nur 50 Weis, 0 Karten
      weisTeamPoints: [0, 50],
      weisNeedsTrick: true,
    });
    // team0: 157 + 100 Matsch = 257; team1: 0 Stiche → Weis weg → 0.
    expect(finalRoundScore(s).team_card_points).toEqual([257, 0]);
    expect(finalRoundScore(s).matsch_team).toBe(0);
  });
});
