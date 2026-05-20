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
const GUMPF = (s: Card["suit"]): Variant => ({ mode: "GUMPF", trump_suit: s });
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
    // Buur nicht in der Hand → kein Bonus, nur Lead-Farbe.
    const hand: Card[] = [c("HERZ", "ASS"), c("HERZ", "SIEBEN")];
    const trick: Card[] = [c("HERZ", "OBER")];
    const v = TRUMPF("EICHEL");
    expect(legalMoves(hand, trick, v)).toEqual(hand);
  });

  it("Jass-Grundregel: Nicht-Trumpf-Lead, kein Trumpf im Stich → bedienen ODER mit jedem Trumpf stechen", () => {
    // „Man muss Farbe geben — außer man will stechen." Liegt noch kein
    // Trumpf im Stich, sticht jeder Trumpf → alle Trümpfe sind legal,
    // auch niedrige Nicht-Buur-Trümpfe, auch wenn man bedienen könnte.
    const hand: Card[] = [
      c("HERZ", "ASS"),
      c("HERZ", "SIEBEN"),
      c("EICHEL", "UNTER"), // Buur
      c("EICHEL", "OBER"),
      c("EICHEL", "SECHS"), // niedriger Trumpf — trotzdem legal
    ];
    const trick: Card[] = [c("HERZ", "OBER")]; // Nicht-Trumpf-Lead, kein Trumpf
    const v = TRUMPF("EICHEL");
    const legal = legalMoves(hand, trick, v);
    // Lead-Farben + ALLE Trümpfe.
    expect(legal).toEqual([
      c("HERZ", "ASS"),
      c("HERZ", "SIEBEN"),
      c("EICHEL", "UNTER"),
      c("EICHEL", "OBER"),
      c("EICHEL", "SECHS"),
    ]);
  });

  it("Jass-Grundregel: GUMPF folgt der gleichen Stech-Regel", () => {
    const hand: Card[] = [c("HERZ", "ZEHN"), c("LAUB", "OBER"), c("LAUB", "SECHS")];
    const trick: Card[] = [c("HERZ", "ASS")];
    const v: Variant = { mode: "GUMPF", trump_suit: "LAUB" };
    const legal = legalMoves(hand, trick, v);
    expect(legal).toEqual([c("HERZ", "ZEHN"), c("LAUB", "OBER"), c("LAUB", "SECHS")]);
  });

  it("Kein-Untertrumpfen: liegt schon ein Trumpf, darf man bei Lead-Farbe nur HÖHER stechen", () => {
    // 4-Spieler-Fall B: Laub angespielt, schon mit Eichel-Ober gestochen.
    // Spieler hat Laub (Lead-Farbe) + Eichel-Ass (höher als Ober) +
    // Eichel-Sechs (tiefer → Untertrumpfen, verboten weil man bedienen
    // könnte).
    const hand: Card[] = [
      c("LAUB", "KOENIG"),
      c("EICHEL", "ASS"), // höher als Ober → legal
      c("EICHEL", "SECHS"), // tiefer als Ober → Untertrumpfen, illegal
    ];
    const trick: Card[] = [c("LAUB", "ZEHN"), c("EICHEL", "OBER")];
    const v = TRUMPF("EICHEL");
    const legal = legalMoves(hand, trick, v);
    expect(legal).toEqual([c("LAUB", "KOENIG"), c("EICHEL", "ASS")]);
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

describe("GUMPF — Hybrid aus Trumpf und Geiss", () => {
  it("cardValue: gleich wie TRUMPF — Buur=20, Nell=14 in Trumpf-Farbe, 8er=0 überall", () => {
    const v = GUMPF("EICHEL");
    expect(cardValue(c("EICHEL", "UNTER"), v)).toBe(20);
    expect(cardValue(c("EICHEL", "NEUN"), v)).toBe(14);
    expect(cardValue(c("HERZ", "ACHT"), v)).toBe(0); // KEIN Geiss-8er-Bonus
    expect(cardValue(c("LAUB", "UNTER"), v)).toBe(2);
    expect(cardValue(c("LAUB", "ASS"), v)).toBe(11);
  });

  it("cardStrength: Trumpf-Karte schlägt jede Nicht-Trumpf-Karte (wie TRUMPF)", () => {
    const v = GUMPF("EICHEL");
    const trumpSix = cardStrength(c("EICHEL", "SECHS"), "HERZ", v);
    const leadAce = cardStrength(c("HERZ", "ASS"), "HERZ", v);
    expect(trumpSix).toBeGreaterThan(leadAce);
  });

  it("cardStrength: Lead-Farbe invertiert (wie UNTEN) — 6 sticht Ass", () => {
    const v = GUMPF("EICHEL");
    const sixInLead = cardStrength(c("HERZ", "SECHS"), "HERZ", v);
    const aceInLead = cardStrength(c("HERZ", "ASS"), "HERZ", v);
    expect(sixInLead).toBeGreaterThan(aceInLead);
  });

  it("cardStrength: Nicht-Lead-Nicht-Trumpf-Karte ist -1", () => {
    const v = GUMPF("EICHEL");
    expect(cardStrength(c("LAUB", "ASS"), "HERZ", v)).toBe(-1);
  });

  it("trickWinner: 6 in Lead-Farbe gewinnt gegen Lead-Ass", () => {
    const trick: Card[] = [c("HERZ", "OBER"), c("HERZ", "SECHS"), c("HERZ", "ASS")];
    expect(trickWinner(trick, GUMPF("EICHEL"))).toBe(1);
  });

  it("trickWinner: Trumpf schlägt 6 in Lead-Farbe", () => {
    const trick: Card[] = [c("HERZ", "SECHS"), c("EICHEL", "SECHS"), c("HERZ", "ASS")];
    // EICHEL ist Trumpf, also schlägt EICHEL-6 (Trumpf-Stärke 10) HERZ-6 (Lead-Stärke 108)
    // → 1000+0 > 100+8 → Index 1 gewinnt.
    expect(trickWinner(trick, GUMPF("EICHEL"))).toBe(1);
  });

  it("legalMoves: Buur-Ausnahme (Nicht-Trumpf-Lead, Lead-Farbe vorhanden + Buur extra)", () => {
    const hand: Card[] = [c("HERZ", "ASS"), c("HERZ", "SIEBEN"), c("EICHEL", "UNTER")];
    const trick: Card[] = [c("HERZ", "OBER")];
    const v = GUMPF("EICHEL");
    expect(legalMoves(hand, trick, v)).toEqual([
      c("HERZ", "ASS"),
      c("HERZ", "SIEBEN"),
      c("EICHEL", "UNTER"),
    ]);
  });

  it("legalMoves: Kein-Untertrumpfen wie TRUMPF (höhere Trümpfe oder Nicht-Trümpfe wenn vorhanden)", () => {
    // Hand mit höherem Trumpf + tieferem Trumpf + Nicht-Trumpf: nur höhere
    // Trümpfe + Nicht-Trümpfe spielbar (tieferer Trumpf gesperrt).
    const hand: Card[] = [
      c("EICHEL", "UNTER"), // Buur, höchster Trumpf
      c("EICHEL", "SECHS"), // tiefer Trumpf
      c("LAUB", "ASS"),
    ];
    const trick: Card[] = [c("HERZ", "ASS"), c("EICHEL", "OBER")]; // Trumpf-Ober im Stich
    const v = GUMPF("EICHEL");
    // Buur > Ober (höherer Trumpf), EICHEL-SECHS < Ober (gesperrt), LAUB-ASS = Nicht-Trumpf
    expect(legalMoves(hand, trick, v)).toEqual([c("EICHEL", "UNTER"), c("LAUB", "ASS")]);
  });

  it("legalMoves: Untertrumpfen erzwungen wenn NUR tiefere Trümpfe in Hand", () => {
    const hand: Card[] = [c("EICHEL", "SIEBEN"), c("EICHEL", "SECHS")];
    const trick: Card[] = [c("HERZ", "ASS"), c("EICHEL", "UNTER")]; // Buur = höchster
    // Keine höheren Trümpfe als Buur, keine Nicht-Trümpfe → alles erlaubt.
    expect(legalMoves(hand, trick, GUMPF("EICHEL"))).toEqual(hand);
  });

  it("legalMoves: Trumpf-Lead + nur Buur als Trumpf → frei wählbar", () => {
    const hand: Card[] = [c("EICHEL", "UNTER"), c("HERZ", "ASS"), c("LAUB", "SIEBEN")];
    const trick: Card[] = [c("EICHEL", "ASS")];
    expect(legalMoves(hand, trick, GUMPF("EICHEL"))).toEqual(hand);
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
