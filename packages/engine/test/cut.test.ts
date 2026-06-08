/**
 * Tests für `cutDeck` (Abheben) + `dealFromDeck`.
 */
import { describe, expect, it } from "vitest";

import { cutDeck, dealFromDeck, freshDeck } from "../src/state.js";
import { cardsEqual } from "../src/cards.js";
import type { Card } from "../src/types.js";

const key = (c: Card): string => `${c.suit}-${c.rank}`;

describe("cutDeck", () => {
  it("schneidet bei Index 16 ab — neu beginnt mit alter Karte 16, danach 0..15", () => {
    const deck = freshDeck();
    const cut = cutDeck(deck, 16);
    expect(cut).toHaveLength(36);
    expect(cardsEqual(cut[0]!, deck[16]!)).toBe(true);
    expect(cardsEqual(cut[35]!, deck[15]!)).toBe(true);
    // Karte an neuer Position 20 = alte 16+20 = 36 → 0.
    expect(cardsEqual(cut[20]!, deck[0]!)).toBe(true);
  });

  it("0 (= Klopfen) lässt die Reihenfolge unverändert", () => {
    const deck = freshDeck();
    expect(cutDeck(deck, 0)).toEqual(deck);
  });

  it("Deckgröße (36) wird modulo zu 0 normalisiert (= Klopfen)", () => {
    const deck = freshDeck();
    expect(cutDeck(deck, 36)).toEqual(deck);
    expect(cutDeck(deck, 72)).toEqual(deck);
  });

  it("negativer Index wird sauber normalisiert", () => {
    const deck = freshDeck();
    // -1 ≡ 35 (mod 36): neu beginnt mit der letzten Karte.
    expect(cardsEqual(cutDeck(deck, -1)[0]!, deck[35]!)).toBe(true);
  });

  it("bleibt eine Permutation — keine Karte geht verloren oder doppelt", () => {
    const deck = freshDeck();
    for (const idx of [1, 9, 17, 18, 25, 35]) {
      const cut = cutDeck(deck, idx);
      expect(new Set(cut.map(key)).size).toBe(36);
      expect(new Set(cut.map(key))).toEqual(new Set(deck.map(key)));
    }
  });
});

describe("dealFromDeck", () => {
  it("teilt 36 Karten in 4 Hände zu je 9 (Sitz 0 = Karten 0..8)", () => {
    const deck = freshDeck();
    const hands = dealFromDeck(deck);
    expect(hands).toHaveLength(4);
    expect(hands.every((h) => h.length === 9)).toBe(true);
    expect(cardsEqual(hands[0]![0]!, deck[0]!)).toBe(true);
    expect(cardsEqual(hands[3]![8]!, deck[35]!)).toBe(true);
  });

  it("nach Abheben verteilt es das umsortierte Deck", () => {
    const deck = freshDeck();
    const hands = dealFromDeck(cutDeck(deck, 9));
    // Nach Cut bei 9 bekommt Sitz 0 die alten Karten 9..17.
    expect(cardsEqual(hands[0]![0]!, deck[9]!)).toBe(true);
  });
});
