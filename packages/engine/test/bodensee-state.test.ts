/**
 * Tests für die Bodensee-Engine: Deal, Move-Anwendung, Tisch-Mechanik,
 * vollständige Runde, Matsch-Erkennung.
 */
import { describe, expect, it } from "vitest";

import {
  applyBodenseeMove,
  BODENSEE_TRICKS_PER_ROUND,
  dealBodensee,
  finalBodenseeScore,
  isBodenseeRoundDone,
  legalMovesBodensee,
  newBodenseeRound,
  whoseTurnBodensee,
} from "../src/bodensee/index.js";
import type { Announcement, Card } from "../src/types.js";

/** Deterministische LCG-RNG. */
function seededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

const TRUMPF_EICHEL: Announcement = {
  variant: { mode: "TRUMPF", trump_suit: "EICHEL" },
  slalom: false,
};

describe("dealBodensee", () => {
  it("verteilt 36 Karten: 2 × (6 Hand + 6 Stapel à 2 Karten)", () => {
    const { hands, tables } = dealBodensee(seededRng(1));
    expect(hands).toHaveLength(2);
    expect(tables).toHaveLength(2);
    for (let p = 0; p < 2; p++) {
      expect(hands[p]).toHaveLength(6);
      expect(tables[p]).toHaveLength(6);
      // Jeder Stapel frisch: visible + hidden gesetzt.
      for (const s of tables[p]!) {
        expect(s.visible).not.toBeNull();
        expect(s.hidden).not.toBeNull();
      }
    }
    // Alle 36 Karten eindeutig.
    const all: Card[] = [];
    for (let p = 0; p < 2; p++) {
      all.push(...hands[p]!);
      for (const s of tables[p]!) {
        if (s.visible) all.push(s.visible);
        if (s.hidden) all.push(s.hidden);
      }
    }
    expect(all).toHaveLength(36);
    expect(new Set(all.map((c) => `${c.suit}-${c.rank}`)).size).toBe(36);
  });

  it("gleicher Seed → identische Verteilung", () => {
    const a = dealBodensee(seededRng(42));
    const b = dealBodensee(seededRng(42));
    expect(a).toEqual(b);
  });
});

describe("Bodensee — Tisch-Mechanik", () => {
  it("eine gespielte Tisch-Karte deckt die verdeckte darunter auf", () => {
    const { hands, tables } = dealBodensee(seededRng(7));
    const state = newBodenseeRound({
      announcement: TRUMPF_EICHEL,
      hands,
      tables,
      announcerIdx: 0,
    });
    // Sitz 0 spielt eine sichtbare Tisch-Karte.
    const stack0 = state.tables[0]![0]!;
    const visibleCard = stack0.visible!;
    const hiddenCard = stack0.hidden!;
    const next = applyBodenseeMove(state, { player: 0, card: visibleCard });
    // visible wurde gespielt, hidden rückt nach.
    expect(next.tables[0]![0]!.visible).toEqual(hiddenCard);
    expect(next.tables[0]![0]!.hidden).toBeNull();
    // Karte liegt im laufenden Stich.
    expect(next.current_trick_cards).toHaveLength(1);
    expect(next.current_trick_cards[0]).toEqual(visibleCard);
  });
});

describe("Bodensee — vollständige Runde", () => {
  it("spielt 18 Stiche durch, Punktesumme plausibel", () => {
    const rng = seededRng(2026);
    const { hands, tables } = dealBodensee(rng);
    let state = newBodenseeRound({
      announcement: TRUMPF_EICHEL,
      hands,
      tables,
      announcerIdx: 0,
    });

    let moves = 0;
    while (!isBodenseeRoundDone(state)) {
      const seat = whoseTurnBodensee(state);
      const legal = legalMovesBodensee(
        state.hands[seat]!,
        state.tables[seat]!,
        state.current_trick_cards,
        state.variant
      );
      expect(legal.length).toBeGreaterThan(0);
      const card = legal[Math.floor(rng() * legal.length)] as Card;
      state = applyBodenseeMove(state, { player: seat, card });
      moves++;
    }

    // 18 Stiche × 2 Karten = 36 Moves.
    expect(moves).toBe(36);
    expect(state.completed_tricks).toHaveLength(BODENSEE_TRICKS_PER_ROUND);
    expect(state.trick_winners).toHaveLength(BODENSEE_TRICKS_PER_ROUND);
    // Alle Karten gespielt: Hände leer, Tische leer.
    for (let p = 0; p < 2; p++) {
      expect(state.hands[p]).toHaveLength(0);
      for (const s of state.tables[p]!) {
        expect(s.visible).toBeNull();
        expect(s.hidden).toBeNull();
      }
    }

    const score = finalBodenseeScore(state);
    const sum = score.player_total_points.reduce((a, b) => a + b, 0);
    // 157 normal (152 + 5 Letzter-Stich) oder 257 mit Matsch.
    expect([157, 257]).toContain(sum);
  });
});

describe("Bodensee — Move-Validierung", () => {
  it("falscher Spieler am Zug → InvalidBodenseeMoveError", () => {
    const { hands, tables } = dealBodensee(seededRng(3));
    const state = newBodenseeRound({
      announcement: TRUMPF_EICHEL,
      hands,
      tables,
      announcerIdx: 0,
    });
    // Sitz 0 ist Starter. Sitz 1 darf nicht beginnen.
    const someCard = state.hands[1]![0]!;
    expect(() => applyBodenseeMove(state, { player: 1, card: someCard })).toThrow(/nicht am Zug/);
  });
});
