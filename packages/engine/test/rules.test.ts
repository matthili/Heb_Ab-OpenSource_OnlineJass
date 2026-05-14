/**
 * Regel-Edge-Cases, die typischerweise still kaputt gehen, wenn man den
 * Python-Code "vom Lesen her" portiert. Die Fixture-Tests decken die häufigen
 * Fälle ab; hier zielen wir auf die Trampelfallen:
 *   - Buur-Ausnahme bei Nicht-Trumpf-Lead
 *   - Buur-allein-als-Trumpf bei Trumpf-Lead → alles spielbar
 *   - Kein-Untertrumpfen, fallback zu "alle Karten" wenn nur tiefere Trümpfe da
 *   - UNTEN: invertierte Stichordnung
 */

import { describe, expect, it } from "vitest";

import { cardStrength, cardValue, legalMoves, trickPoints, trickWinner } from "../src/rules.js";
import type { Card, Variant } from "../src/types.js";

// Kurz-Konstruktoren, damit Test-Tabellen lesbar bleiben.
const c = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank });
const TRUMPF = (s: Card["suit"]): Variant => ({ mode: "TRUMPF", trump_suit: s });
const OBEN: Variant = { mode: "OBEN" };
const UNTEN: Variant = { mode: "UNTEN" };

describe("cardValue", () => {
  it("TRUMPF: Buur=20, Nell=14 nur in Trumpf-Farbe", () => {
    const v = TRUMPF("EICHEL");
    expect(cardValue(c("EICHEL", "UNTER"), v)).toBe(20);
    expect(cardValue(c("EICHEL", "NEUN"), v)).toBe(14);
    expect(cardValue(c("LAUB", "UNTER"), v)).toBe(2); // Unter in nicht-Trumpf-Farbe
    expect(cardValue(c("LAUB", "NEUN"), v)).toBe(0);
  });

  it("TRUMPF: klassische Werte für Ass/10/König/Ober (Trumpf wie Nicht-Trumpf)", () => {
    const v = TRUMPF("HERZ");
    expect(cardValue(c("HERZ", "ASS"), v)).toBe(11);
    expect(cardValue(c("EICHEL", "ASS"), v)).toBe(11);
    expect(cardValue(c("HERZ", "ZEHN"), v)).toBe(10);
    expect(cardValue(c("HERZ", "KOENIG"), v)).toBe(4);
    expect(cardValue(c("HERZ", "OBER"), v)).toBe(3);
  });

  it("OBEN/UNTEN: 8er zählt 8 statt 0", () => {
    expect(cardValue(c("HERZ", "ACHT"), OBEN)).toBe(8);
    expect(cardValue(c("HERZ", "ACHT"), UNTEN)).toBe(8);
    expect(cardValue(c("HERZ", "ACHT"), TRUMPF("EICHEL"))).toBe(0);
  });
});

describe("cardStrength", () => {
  it("TRUMPF wirft, wenn trump_suit fehlt", () => {
    expect(() => cardStrength(c("HERZ", "ASS"), "HERZ", { mode: "TRUMPF" })).toThrow();
  });

  it("TRUMPF: Trumpf-Karte schlägt jede Lead-Karte", () => {
    const v = TRUMPF("EICHEL");
    const trumpSix = cardStrength(c("EICHEL", "SECHS"), "HERZ", v);
    const leadAce = cardStrength(c("HERZ", "ASS"), "HERZ", v);
    expect(trumpSix).toBeGreaterThan(leadAce);
  });

  it("TRUMPF: Karte weder Trumpf noch Lead-Farbe ist -1 (sticht nicht)", () => {
    // EICHEL Trumpf, HERZ angespielt, ich werfe LAUB → -1
    expect(cardStrength(c("LAUB", "ASS"), "HERZ", TRUMPF("EICHEL"))).toBe(-1);
  });

  it("OBEN: Nicht-Lead-Farben sind -1 (stechen nicht)", () => {
    expect(cardStrength(c("LAUB", "ASS"), "HERZ", OBEN)).toBe(-1);
  });

  it("UNTEN: Nicht-Lead-Farben sind -1 (stechen nicht)", () => {
    expect(cardStrength(c("LAUB", "ASS"), "HERZ", UNTEN)).toBe(-1);
  });

  it("UNTEN: 6 sticht Ass innerhalb der Lead-Farbe", () => {
    const six = cardStrength(c("LAUB", "SECHS"), "LAUB", UNTEN);
    const ace = cardStrength(c("LAUB", "ASS"), "LAUB", UNTEN);
    expect(six).toBeGreaterThan(ace);
  });
});

describe("legalMoves: defensive Checks", () => {
  it("TRUMPF ohne trump_suit wirft (defensiver Throw)", () => {
    const hand: Card[] = [c("EICHEL", "ASS"), c("HERZ", "SECHS")];
    const trick: Card[] = [c("EICHEL", "SIEBEN")];
    // TypeScript-Type erzwingt das normalerweise; hier per Cast getestet.
    expect(() => legalMoves(hand, trick, { mode: "TRUMPF" } as unknown as Variant)).toThrow();
  });
});

describe("legalMoves: einfache Fälle", () => {
  it("Leerer Stich → alle Karten erlaubt", () => {
    const hand: Card[] = [c("EICHEL", "ASS"), c("HERZ", "SECHS")];
    expect(legalMoves(hand, [], OBEN)).toEqual(hand);
  });

  it("OBEN/UNTEN: Farbzwang, sonst frei", () => {
    const hand: Card[] = [c("HERZ", "ASS"), c("LAUB", "ZEHN"), c("HERZ", "ACHT")];
    const trick: Card[] = [c("HERZ", "OBER")];
    const legal = legalMoves(hand, trick, OBEN);
    expect(legal).toEqual([c("HERZ", "ASS"), c("HERZ", "ACHT")]);
  });

  it("OBEN/UNTEN: keine Lead-Farbe → alles erlaubt", () => {
    const hand: Card[] = [c("LAUB", "ZEHN"), c("EICHEL", "ASS")];
    const trick: Card[] = [c("HERZ", "OBER")];
    expect(legalMoves(hand, trick, OBEN)).toEqual(hand);
  });
});

describe("legalMoves: TRUMPF — Buur-Ausnahme", () => {
  it("Trumpf-Lead, nur Buur als Trumpf → alle Karten frei wählbar (Buur darf 'versteckt' werden)", () => {
    const hand: Card[] = [c("EICHEL", "UNTER"), c("HERZ", "ASS"), c("LAUB", "SIEBEN")];
    const trick: Card[] = [c("EICHEL", "ASS")];
    const v = TRUMPF("EICHEL");
    expect(legalMoves(hand, trick, v)).toEqual(hand);
  });

  it("Trumpf-Lead, Buur + zweiter Trumpf → muss Trumpf bedienen (beide)", () => {
    const hand: Card[] = [c("EICHEL", "UNTER"), c("EICHEL", "ZEHN"), c("LAUB", "ASS")];
    const trick: Card[] = [c("EICHEL", "ASS")];
    const v = TRUMPF("EICHEL");
    const legal = legalMoves(hand, trick, v);
    expect(legal).toEqual([c("EICHEL", "UNTER"), c("EICHEL", "ZEHN")]);
  });

  it("Nicht-Trumpf-Lead, man hat die Farbe + Buur extra → darf Buur ebenfalls spielen", () => {
    const hand: Card[] = [c("HERZ", "ASS"), c("HERZ", "SIEBEN"), c("EICHEL", "UNTER")];
    const trick: Card[] = [c("HERZ", "OBER")];
    const v = TRUMPF("EICHEL");
    const legal = legalMoves(hand, trick, v);
    expect(legal).toEqual([c("HERZ", "ASS"), c("HERZ", "SIEBEN"), c("EICHEL", "UNTER")]);
  });

  it("Nicht-Trumpf-Lead, Lead-Farbe vorhanden, Buur ist innerhalb der Lead-Farbe → keine Sonderbehandlung", () => {
    // Hier ist die "Lead-Farbe" gleichzeitig die Trumpf-Farbe nicht — der Buur
    // gehört zur Trumpf-Farbe, das wird in der äußeren if-Branch behandelt
    // (lead != trump). Wenn der "Buur" in den same-suit-Karten landen würde,
    // wäre die Lead-Farbe selbst Trumpf — Widerspruch.
    // Dieses Szenario testet stattdessen: Buur nicht in der Hand → kein Bonus.
    const hand: Card[] = [c("HERZ", "ASS"), c("HERZ", "SIEBEN")];
    const trick: Card[] = [c("HERZ", "OBER")];
    const v = TRUMPF("EICHEL");
    expect(legalMoves(hand, trick, v)).toEqual(hand);
  });
});

describe("legalMoves: TRUMPF — Kein-Untertrumpfen", () => {
  it("Trumpf liegt im Stich, höhere Trümpfe vorhanden → nur höhere + Nicht-Trümpfe", () => {
    // EICHEL trumpf, jemand hat OBER (TRUMP_ORDER 4) gestochen; in der Hand habe
    // ich UNTER (8 → höher) und 7 (1 → tiefer) und einen Nicht-Trumpf.
    const hand: Card[] = [c("EICHEL", "UNTER"), c("EICHEL", "SIEBEN"), c("HERZ", "ASS")];
    const trick: Card[] = [c("LAUB", "ASS"), c("EICHEL", "OBER")];
    const v = TRUMPF("EICHEL");
    expect(legalMoves(hand, trick, v)).toEqual([c("EICHEL", "UNTER"), c("HERZ", "ASS")]);
  });

  it("Trumpf liegt im Stich, NUR tiefere Trümpfe vorhanden → Untertrumpfen erzwungen, alles erlaubt", () => {
    const hand: Card[] = [c("EICHEL", "SIEBEN"), c("EICHEL", "SECHS")];
    const trick: Card[] = [c("LAUB", "ASS"), c("EICHEL", "UNTER")]; // höchster Trumpf liegt
    const v = TRUMPF("EICHEL");
    expect(legalMoves(hand, trick, v)).toEqual(hand);
  });

  it("Kein Trumpf im Stich, Lead-Farbe nicht in Hand → alles abwerfbar", () => {
    const hand: Card[] = [c("EICHEL", "SIEBEN"), c("LAUB", "ASS")];
    const trick: Card[] = [c("HERZ", "ASS")];
    const v = TRUMPF("EICHEL");
    expect(legalMoves(hand, trick, v)).toEqual(hand);
  });
});

describe("trickWinner", () => {
  it("TRUMPF: Trumpf gewinnt gegen Lead-Ass", () => {
    const trick: Card[] = [c("HERZ", "ASS"), c("EICHEL", "SECHS"), c("HERZ", "SIEBEN")];
    expect(trickWinner(trick, TRUMPF("EICHEL"))).toBe(1);
  });

  it("OBEN: Lead-Ass gewinnt", () => {
    const trick: Card[] = [c("HERZ", "OBER"), c("HERZ", "ASS"), c("LAUB", "ASS")];
    expect(trickWinner(trick, OBEN)).toBe(1);
  });

  it("UNTEN: Lead-Sechs gewinnt gegen Lead-Ass", () => {
    const trick: Card[] = [c("HERZ", "OBER"), c("HERZ", "SECHS"), c("HERZ", "ASS")];
    expect(trickWinner(trick, UNTEN)).toBe(1);
  });

  it("Wirft bei leerem Stich", () => {
    expect(() => trickWinner([], OBEN)).toThrow();
  });
});

describe("trickPoints", () => {
  it("Summe der Kartenwerte", () => {
    const trick: Card[] = [
      c("HERZ", "ASS"),
      c("HERZ", "ZEHN"),
      c("HERZ", "ACHT"),
      c("HERZ", "SECHS"),
    ];
    expect(trickPoints(trick, OBEN)).toBe(11 + 10 + 8 + 0);
  });

  it("Letzter Stich addiert 5", () => {
    const trick: Card[] = [c("HERZ", "ASS")];
    expect(trickPoints(trick, OBEN, true)).toBe(11 + 5);
  });

  it("TRUMPF: Buur gibt 20", () => {
    const trick: Card[] = [c("EICHEL", "UNTER"), c("EICHEL", "NEUN")];
    expect(trickPoints(trick, TRUMPF("EICHEL"))).toBe(20 + 14);
  });
});
