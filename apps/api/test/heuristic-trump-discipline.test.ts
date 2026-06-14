/**
 * Tests für die void-tracking Trumpf-Disziplin der Heuristik (NN-Briefing
 * v0.7.2/v0.8.2, Punkt 2b). TS-Port von `tests/test_heuristic_trump_discipline.py`.
 *
 * Sind beide Gegner beweisbar trumpffrei, soll der Heuristik-Spieler beim
 * Anspielen KEINE Trümpfe mehr ziehen (das zöge nur dem Partner die Trümpfe),
 * sondern hohe Seitenkarten spielen.
 */
import { describe, expect, it } from "vitest";

import type { Card, CompletedTrick, GameState, Variant } from "@jass/engine";

import { HeuristicPlayer } from "../src/modules/game/players/heuristic-player.js";

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

/**
 * Sitz 0 ist am Anspielen; in Stich 0 wurde Trumpf (Eichel) geführt und beide
 * Gegner (Sitze 1 und 3) konnten nicht folgen → trumpffrei. Sitz 2 (Partner)
 * folgte Trumpf.
 */
function stateOpponentsVoidInTrump(variant: Variant): GameState {
  const trick: CompletedTrick = {
    starter: 0,
    cards: [
      card("EICHEL", "ASS"), // Sitz 0 führt Trumpf
      card("SCHELLE", "SIEBEN"), // Sitz 1 wirft ab → blank in Trumpf
      card("EICHEL", "KOENIG"), // Sitz 2 (Partner) folgt Trumpf
      card("LAUB", "ACHT"), // Sitz 3 wirft ab → blank in Trumpf
    ],
  };
  return {
    player_idx: 0,
    variant,
    announcement: { variant, slalom: false },
    current_trick_cards: [],
    current_trick_starter: 0,
    teams: [0, 1, 0, 1],
    completed_tricks: [trick],
    own_team_score: 0,
    opp_team_score: 0,
    round_idx: 0,
    trick_idx: 1,
    num_players: 4,
  };
}

describe("HeuristicPlayer — Trumpf-Disziplin (void-awareness)", () => {
  it("TRUMPF: spielt das Seiten-Ass statt des Buurs, wenn beide Gegner blank sind", () => {
    const variant: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
    const state = stateOpponentsVoidInTrump(variant);
    const hand: Card[] = [
      card("EICHEL", "UNTER"), // Buur (höchster Trumpf)
      card("SCHELLE", "ASS"), // Seiten-Ass
      card("LAUB", "KOENIG"),
    ];
    const aware = new HeuristicPlayer(); // trumpVoidAwareness default true
    expect(aware.chooseCard(hand, state)).toEqual(card("SCHELLE", "ASS"));
  });

  it("TRUMPF: zieht den Buur, wenn Awareness aus ist (Alt-Verhalten)", () => {
    const variant: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
    const state = stateOpponentsVoidInTrump(variant);
    const hand: Card[] = [
      card("EICHEL", "UNTER"),
      card("SCHELLE", "ASS"),
      card("LAUB", "KOENIG"),
    ];
    const legacy = new HeuristicPlayer({ trumpVoidAwareness: false });
    expect(legacy.chooseCard(hand, state)).toEqual(card("EICHEL", "UNTER"));
  });

  it("TRUMPF: ohne Verlauf (kein Beweis) wird wie bisher der Buur gezogen", () => {
    const variant: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
    const state: GameState = {
      ...stateOpponentsVoidInTrump(variant),
      completed_tricks: [],
      trick_idx: 0,
    };
    const hand: Card[] = [card("EICHEL", "UNTER"), card("SCHELLE", "ASS")];
    expect(new HeuristicPlayer().chooseCard(hand, state)).toEqual(card("EICHEL", "UNTER"));
  });

  it("GUMPF: spielt den sicheren 6er-Sticher statt Trumpf, wenn Gegner blank", () => {
    const variant: Variant = { mode: "GUMPF", trump_suit: "EICHEL" };
    const state = stateOpponentsVoidInTrump(variant);
    const hand: Card[] = [
      card("EICHEL", "UNTER"), // Buur
      card("SCHELLE", "SECHS"), // 6er = sicherer Sticher im Gumpf
      card("LAUB", "KOENIG"),
    ];
    expect(new HeuristicPlayer().chooseCard(hand, state)).toEqual(card("SCHELLE", "SECHS"));
  });
});
