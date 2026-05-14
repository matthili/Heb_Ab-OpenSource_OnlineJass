import { describe, expect, it } from "vitest";

import { cardIndex, cardsEqual, indexToCard, isWeli } from "../src/cards.js";
import { DECK_SIZE, RANKS, SUITS, WELI, WELI_INDEX, type Card } from "../src/types.js";

describe("cardIndex / indexToCard", () => {
  it("Eichel-Sechs ist 0, Eichel-Ass ist 8", () => {
    expect(cardIndex({ suit: "EICHEL", rank: "SECHS" })).toBe(0);
    expect(cardIndex({ suit: "EICHEL", rank: "ASS" })).toBe(8);
  });

  it("Schelle-Sechs (Weli) ist 9", () => {
    expect(cardIndex(WELI)).toBe(WELI_INDEX);
  });

  it("Laub-Ass ist 35", () => {
    expect(cardIndex({ suit: "LAUB", rank: "ASS" })).toBe(35);
  });

  it("Round-trip über alle 36 Karten ist bijektiv", () => {
    const seen = new Set<number>();
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const c: Card = { suit, rank };
        const i = cardIndex(c);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(DECK_SIZE);
        expect(seen.has(i)).toBe(false);
        seen.add(i);
        const back = indexToCard(i);
        expect(back).toEqual(c);
      }
    }
    expect(seen.size).toBe(DECK_SIZE);
  });

  it("indexToCard wirft bei ungültigem Index", () => {
    expect(() => indexToCard(-1)).toThrow(RangeError);
    expect(() => indexToCard(36)).toThrow(RangeError);
    expect(() => indexToCard(1.5)).toThrow(RangeError);
  });
});

describe("cardsEqual / isWeli", () => {
  it("cardsEqual ist strukturell", () => {
    expect(cardsEqual({ suit: "HERZ", rank: "ASS" }, { suit: "HERZ", rank: "ASS" })).toBe(true);
    expect(cardsEqual({ suit: "HERZ", rank: "ASS" }, { suit: "LAUB", rank: "ASS" })).toBe(false);
    expect(cardsEqual({ suit: "HERZ", rank: "ASS" }, { suit: "HERZ", rank: "KOENIG" })).toBe(false);
  });

  it("isWeli erkennt Schelle-Sechs", () => {
    expect(isWeli({ suit: "SCHELLE", rank: "SECHS" })).toBe(true);
    expect(isWeli({ suit: "SCHELLE", rank: "SIEBEN" })).toBe(false);
    expect(isWeli({ suit: "EICHEL", rank: "SECHS" })).toBe(false);
  });
});
