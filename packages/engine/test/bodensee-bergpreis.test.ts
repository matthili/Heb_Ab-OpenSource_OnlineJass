/**
 * Tests für den Bodensee-„Bergpreis"-Sieger. Leere Tricks → deterministisch:
 * nur der letzte Stich bringt +5 Kartenpunkte; Matsch (+100) kommt am Ende.
 */
import { describe, expect, it } from "vitest";

import { bodenseeBergpreisWinnerFromState } from "../src/bodensee/bergpreis.js";
import type { Announcement, BodenseeRoundState, CompletedTrick, Variant } from "../src/index.js";

const VARIANT: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
const ANNOUNCEMENT: Announcement = { variant: VARIANT, slalom: false };

function doneState(trickWinners: readonly number[], sackRule = false): BodenseeRoundState {
  const dummyTricks: CompletedTrick[] = Array.from({ length: 18 }, () => ({
    starter: 0,
    cards: [],
  }));
  return {
    variant: VARIANT,
    announcement: ANNOUNCEMENT,
    hands: [[], []],
    tables: [[], []],
    current_trick_cards: [],
    current_trick_starter: 0,
    completed_tricks: dummyTricks,
    trick_winners: trickWinners,
    player_card_points: [0, 0],
    announcer_idx: 0,
    round_idx: 0,
    trick_idx: 18,
    sack_rule: sackRule,
  };
}

describe("bodenseeBergpreisWinnerFromState", () => {
  it("Matsch + letzter-Stich-Bonus bringen Spieler 0 übers Ziel", () => {
    // Spieler 0 holt alle 18 Stiche → 5 Karten (nur letzter Stich) + 100 Matsch.
    // 900 + 105 = 1005 ≥ 1000.
    const allFirst = Array.from({ length: 18 }, () => 0);
    expect(bodenseeBergpreisWinnerFromState(doneState(allFirst), [900, 0], 1000)).toBe(0);
  });

  it("Sack sperrt die Wertung unter 21 Kartenpunkten (kein Sieg)", () => {
    // Leere Tricks → Spieler 0 hat nur 5 Kartenpunkte (< 21) → bei Sack verfällt
    // alles (auch der Matsch-Bonus); niemand erreicht das Ziel.
    const allFirst = Array.from({ length: 18 }, () => 0);
    expect(bodenseeBergpreisWinnerFromState(doneState(allFirst, true), [900, 0], 1000)).toBe(-1);
  });

  it("normaler Erst-Erreicher: Spieler 1 gewinnt den letzten Stich und kommt knapp übers Ziel", () => {
    // 17 Stiche an Spieler 0 (ohne Punkte, da leere Tricks), letzter an Spieler 1
    // → Spieler 1 bekommt die +5. preGame so, dass das genau reicht.
    const winners = [...Array.from({ length: 17 }, () => 0), 1];
    expect(bodenseeBergpreisWinnerFromState(doneState(winners), [0, 996], 1000)).toBe(1);
  });
});
