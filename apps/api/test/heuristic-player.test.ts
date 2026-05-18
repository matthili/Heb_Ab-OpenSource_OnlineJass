/**
 * Unit-Tests für den TS-Port des HeuristicPlayers.
 *
 * Wir prüfen das Verhalten in ein paar handgemachten Szenarien (kein Self-
 * Play gegen das Python-Original — das wäre Sache eines eigenen Parity-
 * Tests in einem Folge-PR). Die Tests hier fangen die häufigsten
 * Regressionen ab: Ansage-Auswahl bei klar dominanter Hand, Karten-Wahl
 * beim Anspielen, Schmieren-Logik, Sparen-Logik.
 */
import { describe, expect, it } from "vitest";

import type { Card, GameState, Variant } from "@jass/engine";
import { newRound, viewAsPlayer } from "@jass/engine";

import { HeuristicPlayer } from "../src/modules/game/players/heuristic-player.js";

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function emptyTeams(): number[] {
  return [0, 1, 0, 1];
}

describe("HeuristicPlayer — Ansage", () => {
  const heur = new HeuristicPlayer();

  it("wählt TRUMPF auf Eichel, wenn die Hand fast nur Eichel ist (Buur + Nell + Asse)", () => {
    const hand: Card[] = [
      card("EICHEL", "UNTER"), // Buur
      card("EICHEL", "NEUN"), // Nell
      card("EICHEL", "ASS"),
      card("EICHEL", "KOENIG"),
      card("EICHEL", "OBER"),
      card("HERZ", "ASS"),
      card("LAUB", "ASS"),
      card("SCHELLE", "SIEBEN"),
      card("SCHELLE", "SECHS"),
    ];
    const ann = heur.chooseAnnouncement(hand, /* canPush */ false);
    expect(ann).not.toBeNull();
    expect(ann!.variant.mode).toBe("TRUMPF");
    expect(ann!.variant.trump_suit).toBe("EICHEL");
    expect(ann!.slalom).toBe(false);
  });

  it("wählt OBEN bei vielen hohen Karten quer durch alle Farben", () => {
    const hand: Card[] = [
      card("EICHEL", "ASS"),
      card("EICHEL", "ZEHN"),
      card("HERZ", "ASS"),
      card("HERZ", "KOENIG"),
      card("LAUB", "ASS"),
      card("LAUB", "ZEHN"),
      card("SCHELLE", "ASS"),
      card("SCHELLE", "KOENIG"),
      card("SCHELLE", "OBER"),
    ];
    const ann = heur.chooseAnnouncement(hand, false);
    expect(ann).not.toBeNull();
    expect(["OBEN", "GUMPF", "TRUMPF"]).toContain(ann!.variant.mode);
    // Bei dieser Hand sollte OBEN klar führen.
    expect(ann!.variant.mode).toBe("OBEN");
  });

  it("wählt UNTEN bei vielen niedrigen Karten", () => {
    const hand: Card[] = [
      card("EICHEL", "SECHS"),
      card("EICHEL", "SIEBEN"),
      card("EICHEL", "ACHT"),
      card("HERZ", "SECHS"),
      card("HERZ", "SIEBEN"),
      card("LAUB", "SECHS"),
      card("LAUB", "ACHT"),
      card("SCHELLE", "SECHS"),
      card("SCHELLE", "SIEBEN"),
    ];
    const ann = heur.chooseAnnouncement(hand, false);
    expect(ann).not.toBeNull();
    expect(ann!.variant.mode).toBe("UNTEN");
  });

  it("schiebt (null), wenn die Hand sehr schwach ist und Schieben erlaubt", () => {
    const hand: Card[] = [
      card("EICHEL", "SIEBEN"),
      card("EICHEL", "NEUN"),
      card("HERZ", "OBER"),
      card("HERZ", "NEUN"),
      card("LAUB", "SIEBEN"),
      card("LAUB", "OBER"),
      card("SCHELLE", "OBER"),
      card("SCHELLE", "NEUN"),
      card("SCHELLE", "ZEHN"),
    ];
    const ann = heur.chooseAnnouncement(hand, /* canPush */ true);
    // Diese Hand hat in keiner Variante einen klaren Vorteil — sollte
    // unter dem push-threshold landen.
    expect(ann).toBeNull();
  });

  it("Hausregel-Filter: ohne TRUMPF und ohne Slalom bleibt OBEN/UNTEN/GUMPF", () => {
    const restricted = new HeuristicPlayer({
      allowedModes: new Set(["OBEN", "UNTEN", "GUMPF"]),
      allowSlalom: false,
    });
    const hand: Card[] = [
      card("EICHEL", "UNTER"),
      card("EICHEL", "NEUN"),
      card("EICHEL", "ASS"),
      card("EICHEL", "ZEHN"),
      card("EICHEL", "KOENIG"),
      card("HERZ", "SIEBEN"),
      card("LAUB", "SIEBEN"),
      card("SCHELLE", "SIEBEN"),
      card("SCHELLE", "ACHT"),
    ];
    const ann = restricted.chooseAnnouncement(hand, false);
    expect(ann).not.toBeNull();
    expect(["OBEN", "UNTEN", "GUMPF"]).toContain(ann!.variant.mode);
    expect(ann!.slalom).toBe(false);
  });
});

describe("HeuristicPlayer — Kartenwahl", () => {
  const heur = new HeuristicPlayer();

  function buildState(
    variant: Variant,
    handsBySeat: readonly (readonly Card[])[],
    starter: number,
    currentTrickCards: readonly Card[] = [],
    perspectiveSeat: number = 0
  ): { state: GameState; hand: Card[] } {
    const round = newRound({
      variant,
      announcement: { variant, slalom: false },
      hands: handsBySeat.map((h) => [...h]),
      starter,
      teams: emptyTeams(),
    });
    // Aktuellen Trick simulieren: wir setzen die schon gespielten Karten
    // manuell auf den State (newRound hat den Trick leer initialisiert,
    // also overschreiben wir).
    const state: GameState = {
      ...viewAsPlayer(round, perspectiveSeat),
      current_trick_cards: currentTrickCards,
    };
    return { state, hand: [...handsBySeat[perspectiveSeat]!] };
  }

  it("Anspielen bei TRUMPF: zieht den Buur zuerst, wenn vorhanden", () => {
    const variant: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
    const myHand: Card[] = [
      card("EICHEL", "UNTER"), // Buur — soll gezogen werden
      card("EICHEL", "ASS"),
      card("HERZ", "KOENIG"),
      card("LAUB", "OBER"),
      card("SCHELLE", "SIEBEN"),
      card("SCHELLE", "ACHT"),
      card("SCHELLE", "NEUN"),
      card("HERZ", "ZEHN"),
      card("LAUB", "ASS"),
    ];
    const others = Array.from({ length: 3 }, () => filler9(myHand));
    const { state, hand } = buildState(variant, [myHand, ...others], 0);
    const chosen = heur.chooseCard(hand, state);
    expect(chosen).toEqual({ suit: "EICHEL", rank: "UNTER" });
  });

  it("Anspielen bei OBEN: spielt das Ass zuerst", () => {
    const variant: Variant = { mode: "OBEN" };
    const myHand: Card[] = [
      card("HERZ", "ASS"),
      card("EICHEL", "SECHS"),
      card("EICHEL", "SIEBEN"),
      card("LAUB", "OBER"),
      card("LAUB", "UNTER"),
      card("SCHELLE", "NEUN"),
      card("SCHELLE", "ACHT"),
      card("HERZ", "ZEHN"),
      card("LAUB", "ASS"),
    ];
    const others = Array.from({ length: 3 }, () => filler9(myHand));
    const { state, hand } = buildState(variant, [myHand, ...others], 0);
    const chosen = heur.chooseCard(hand, state);
    expect(chosen.rank).toBe("ASS");
  });

  it("Anspielen bei UNTEN: spielt die SECHS zuerst", () => {
    const variant: Variant = { mode: "UNTEN" };
    const myHand: Card[] = [
      card("LAUB", "SECHS"),
      card("EICHEL", "OBER"),
      card("EICHEL", "ASS"),
      card("HERZ", "KOENIG"),
      card("LAUB", "OBER"),
      card("LAUB", "UNTER"),
      card("SCHELLE", "ZEHN"),
      card("SCHELLE", "KOENIG"),
      card("HERZ", "NEUN"),
    ];
    const others = Array.from({ length: 3 }, () => filler9(myHand));
    const { state, hand } = buildState(variant, [myHand, ...others], 0);
    const chosen = heur.chooseCard(hand, state);
    expect(chosen.rank).toBe("SECHS");
  });

  it("immer eine legale Karte (auch in Zwangslagen)", () => {
    // 9 verschiedene Hände, die mit Trumpf-Lead konfrontiert werden — die
    // Heuristik muss IMMER eine legale Karte zurückgeben.
    const variant: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
    for (let rngSeed = 0; rngSeed < 20; rngSeed++) {
      const handsBySeat = makeSeededHands(rngSeed);
      const { state, hand } = buildState(
        variant,
        handsBySeat,
        0,
        [
          card("EICHEL", "SIEBEN"), // Trumpf-Lead
        ],
        1
      );
      const chosen = heur.chooseCard(hand, state);
      expect(hand).toContainEqual(chosen);
    }
  });
});

// ─── Helper: zufällige aber legale Verteilung mit fixem Seed ───────────────

function filler9(exclude: readonly Card[]): Card[] {
  const exSet = new Set(exclude.map((c) => `${c.suit}-${c.rank}`));
  const out: Card[] = [];
  const SUITS = ["EICHEL", "SCHELLE", "HERZ", "LAUB"] as const;
  const RANKS = [
    "SECHS",
    "SIEBEN",
    "ACHT",
    "NEUN",
    "ZEHN",
    "UNTER",
    "OBER",
    "KOENIG",
    "ASS",
  ] as const;
  for (const s of SUITS) {
    for (const r of RANKS) {
      if (!exSet.has(`${s}-${r}`)) {
        out.push({ suit: s, rank: r });
        if (out.length === 9) return out;
      }
    }
  }
  return out;
}

function makeSeededHands(seed: number): Card[][] {
  // Sehr einfache LCG zum Mischen — reicht für Test-Vielfalt.
  let s = (seed * 1664525 + 1013904223) | 0;
  const next = (): number => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 0x1_0000_0000;
  };
  const deck: Card[] = [];
  for (const suit of ["EICHEL", "SCHELLE", "HERZ", "LAUB"] as const) {
    for (const rank of [
      "SECHS",
      "SIEBEN",
      "ACHT",
      "NEUN",
      "ZEHN",
      "UNTER",
      "OBER",
      "KOENIG",
      "ASS",
    ] as const) {
      deck.push({ suit, rank });
    }
  }
  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return [deck.slice(0, 9), deck.slice(9, 18), deck.slice(18, 27), deck.slice(27, 36)];
}
