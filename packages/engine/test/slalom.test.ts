/**
 * Tests für Slalom: die effektive Variante alterniert pro Stich (OBEN/UNTEN),
 * und Stich-Gewinner plus Punkte richten sich nach der Variante DES STICHS.
 *
 * Regressionstest zum Bug „Slalom wertet Stich 2 (UNTEN) wie OBEN aus".
 */
import { describe, expect, it } from "vitest";

import {
  applyMove,
  dealCards,
  effectiveVariant,
  handOf,
  newRound,
  whoseTurn,
} from "../src/state.js";
import { legalMoves, trickWinner } from "../src/rules.js";
import type { Announcement, Card } from "../src/types.js";

function seededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

const c = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank });

describe("effectiveVariant", () => {
  it("ohne Slalom: immer die angesagte Variante", () => {
    const ann: Announcement = { variant: { mode: "TRUMPF", trump_suit: "EICHEL" }, slalom: false };
    expect(effectiveVariant(ann, 0)).toEqual({ mode: "TRUMPF", trump_suit: "EICHEL" });
    expect(effectiveVariant(ann, 5)).toEqual({ mode: "TRUMPF", trump_suit: "EICHEL" });
  });

  it("Slalom ab OBEN: 0=OBEN, 1=UNTEN, 2=OBEN, 3=UNTEN …", () => {
    const ann: Announcement = { variant: { mode: "OBEN" }, slalom: true };
    expect(effectiveVariant(ann, 0).mode).toBe("OBEN");
    expect(effectiveVariant(ann, 1).mode).toBe("UNTEN");
    expect(effectiveVariant(ann, 2).mode).toBe("OBEN");
    expect(effectiveVariant(ann, 3).mode).toBe("UNTEN");
  });

  it("Slalom ab UNTEN: 0=UNTEN, 1=OBEN, …", () => {
    const ann: Announcement = { variant: { mode: "UNTEN" }, slalom: true };
    expect(effectiveVariant(ann, 0).mode).toBe("UNTEN");
    expect(effectiveVariant(ann, 1).mode).toBe("OBEN");
  });
});

describe("trickWinner bei UNTEN (Geiss): niedrigste Karte sticht", () => {
  it("Eichel 6 schlägt 8/Ober/König (genau das gemeldete Szenario)", () => {
    const trick = [
      c("EICHEL", "SECHS"),
      c("EICHEL", "ACHT"),
      c("EICHEL", "OBER"),
      c("EICHEL", "KOENIG"),
    ];
    // UNTEN: die Sechs ist die höchste „Untenufe"-Karte → Index 0 gewinnt.
    expect(trickWinner(trick, { mode: "UNTEN" })).toBe(0);
    // Gegenprobe OBEN: der König (Index 3) gewinnt.
    expect(trickWinner(trick, { mode: "OBEN" })).toBe(3);
  });
});

describe("Anzeige-Regression: abgeschlossener Slalom-Stich braucht SEINE EIGENE Variante", () => {
  // Gemeldetes Szenario (Solo, Slalom-OBEN): Spieler spielt Herz-Ass aus,
  // dann Herz-Unter, Eichel-Ober, Herz-10. Korrekt sticht Herz-Ass (OBEN).
  // Das Frontend hatte den fertigen Stich aber mit `state.variant` gewertet —
  // und das ist nach Stich-Abschluss bereits die Variante des NÄCHSTEN Stichs
  // (UNTEN). In UNTEN gewinnt unter den Herz-Karten die Herz-10 → falsches
  // Highlight + falscher „letzter Stich"-Name. Fix: Stich i mit
  // effectiveVariant(ann, i) werten.
  it("Herz-Ass sticht in OBEN — NICHT Herz-10 (das wäre die Folge-Variante)", () => {
    const ann: Announcement = { variant: { mode: "OBEN" }, slalom: true };
    const trick = [
      c("HERZ", "ASS"), // idx 0 — Anspieler
      c("HERZ", "UNTER"), // idx 1
      c("EICHEL", "OBER"), // idx 2 — Fehlfarbe, sticht nie
      c("HERZ", "ZEHN"), // idx 3
    ];
    // Richtig: Variante DES Stichs (Index 0 → OBEN) → Herz-Ass (Index 0).
    expect(trickWinner(trick, effectiveVariant(ann, 0))).toBe(0);
    // Der alte Bug: Variante des NÄCHSTEN Stichs (Index 1 → UNTEN) →
    // fälschlich Herz-10 (Index 3). Genau das hatte der Spieler gesehen.
    expect(trickWinner(trick, effectiveVariant(ann, 1))).toBe(3);
  });
});

describe("applyMove: Slalom flippt die Variante nach jedem Stich", () => {
  it("OBEN → UNTEN → OBEN über zwei volle Stiche", () => {
    const hands = dealCards(seededRng(42));
    const ann: Announcement = { variant: { mode: "OBEN" }, slalom: true };
    let s = newRound({ variant: { mode: "OBEN" }, announcement: ann, hands, starter: 0 });
    expect(s.variant.mode).toBe("OBEN"); // Stich 0

    const playFullTrick = (): void => {
      for (let i = 0; i < 4; i++) {
        const seat = whoseTurn(s);
        const legal = legalMoves(handOf(s, seat), s.current_trick_cards, s.variant);
        s = applyMove(s, { seat, card: legal[0]! });
      }
    };

    playFullTrick();
    expect(s.trick_idx).toBe(1);
    expect(s.variant.mode).toBe("UNTEN"); // nach Stich 0 geflippt

    playFullTrick();
    expect(s.trick_idx).toBe(2);
    expect(s.variant.mode).toBe("OBEN"); // nach Stich 1 zurückgeflippt
  });
});
