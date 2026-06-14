/**
 * Tests für die „Sack"-Regel im Bodensee-Scoring (`finalBodenseeScore`).
 *
 * Sack (Tisch-Option): Wer unter `SACK_MIN_POINTS` (21) reine Kartenpunkte
 * bleibt, bekommt GAR NICHTS gewertet — die Punkte verfallen (kein Transfer).
 * Bug-Fix 2026-06-14: vorher ignorierte das Bodensee-Scoring die Regel ganz.
 */
import { describe, expect, it } from "vitest";

import {
  finalBodenseeScore,
  MATCH_BONUS,
  SACK_MIN_POINTS,
  type Announcement,
  type BodenseeRoundState,
  type CompletedTrick,
  type Variant,
} from "../src/index.js";

const VARIANT: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
const ANNOUNCEMENT: Announcement = { variant: VARIANT, slalom: false };

/** Minimaler fertiger 18-Stich-Zustand (nur die fürs Scoring relevanten Felder). */
function doneState(
  playerCardPoints: readonly number[],
  trickWinners: readonly number[],
  sackRule: boolean
): BodenseeRoundState {
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
    player_card_points: playerCardPoints,
    announcer_idx: 0,
    round_idx: 0,
    trick_idx: 18,
    sack_rule: sackRule,
  };
}

describe("finalBodenseeScore — Sack-Regel", () => {
  it("voidet den Spieler unter 21 Kartenpunkten (Punkte → 0)", () => {
    const score = finalBodenseeScore(doneState([140, 17], [0, 1], true));
    expect(score.player_total_points).toEqual([140, 0]);
    expect(score.voided).toEqual([{ player: 1, cardPoints: 17 }]);
  });

  it("ohne Sack-Option bleiben die 17 Punkte stehen (kein voided)", () => {
    const score = finalBodenseeScore(doneState([140, 17], [0, 1], false));
    expect(score.player_total_points).toEqual([140, 17]);
    expect(score.voided).toBeUndefined();
  });

  it("genau 21 Punkte zählen noch (Grenze ist exklusiv)", () => {
    expect(SACK_MIN_POINTS).toBe(21);
    const score = finalBodenseeScore(doneState([136, 21], [0, 1], true));
    expect(score.player_total_points).toEqual([136, 21]);
    expect(score.voided).toBeUndefined();
  });

  it("Matsch + Sack: Matsch-Gewinner bekommt Bonus, der 0-Punkte-Verlierer bleibt 0", () => {
    const allFirst = Array.from({ length: 18 }, () => 0);
    const score = finalBodenseeScore(doneState([157, 0], allFirst, true));
    expect(score.matsch_player).toBe(0);
    expect(score.player_total_points).toEqual([157 + MATCH_BONUS, 0]);
    expect(score.voided).toEqual([{ player: 1, cardPoints: 0 }]);
  });
});
