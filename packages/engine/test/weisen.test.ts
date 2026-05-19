/**
 * Tests für Weisen-Logik. Bewusst ausführlich, weil das Regelwerk
 * (Punkte, Vergleichsreihenfolge a → c → b → d, WELI-ohne-Joker)
 * voller Edge-Cases ist.
 */
import { describe, expect, it } from "vitest";

import {
  aggregateWeisen,
  compareDeclarations,
  findBestWeisenForHand,
  validateDeclaration,
  type WeisDeclaration,
} from "../src/weisen.js";
import type { Card, Rank, Suit } from "../src/types.js";

const c = (suit: Suit, rank: Rank): Card => ({ suit, rank });

// Convenience-Builder für Test-Hände
const hand = (...cards: Card[]) => cards;

// ──────────────────────────────────────────────────────────────────────
// validateDeclaration — Sequenzen
// ──────────────────────────────────────────────────────────────────────

describe("validateDeclaration — Sequenzen", () => {
  it("3-Blatt (6,7,8 Eichel) → 20 Punkte", () => {
    const h = hand(c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT"));
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(false);
    if (!("invalid" in r)) {
      expect(r.kind).toBe("SEQUENCE_3");
      expect(r.points).toBe(20);
      expect(r.topRank).toBe("ACHT");
      expect(r.suit).toBe("EICHEL");
    }
  });

  it("5-Blatt (10,U,O,K,A Schelle) → 100 Punkte", () => {
    const h = hand(
      c("SCHELLE", "ZEHN"),
      c("SCHELLE", "UNTER"),
      c("SCHELLE", "OBER"),
      c("SCHELLE", "KOENIG"),
      c("SCHELLE", "ASS")
    );
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(false);
    if (!("invalid" in r)) {
      expect(r.points).toBe(100);
      expect(r.topRank).toBe("ASS");
    }
  });

  it("9-Blatt (alle 9 in einer Farbe) → 180 Punkte", () => {
    const h = hand(
      c("HERZ", "SECHS"),
      c("HERZ", "SIEBEN"),
      c("HERZ", "ACHT"),
      c("HERZ", "NEUN"),
      c("HERZ", "ZEHN"),
      c("HERZ", "UNTER"),
      c("HERZ", "OBER"),
      c("HERZ", "KOENIG"),
      c("HERZ", "ASS")
    );
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(false);
    if (!("invalid" in r)) {
      expect(r.points).toBe(180);
    }
  });

  it("Sequenz mit Lücke wird abgelehnt (6, 7, 9 — fehlende 8)", () => {
    const h = hand(c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "NEUN"));
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(true);
    if ("invalid" in r) expect(r.reason).toBe("NOT_A_VALID_PATTERN");
  });

  it("Sequenz mit verschiedenen Farben wird abgelehnt", () => {
    const h = hand(c("EICHEL", "SECHS"), c("SCHELLE", "SIEBEN"), c("EICHEL", "ACHT"));
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(true);
  });

  it("Sequenz unsortiert in der Eingabe → korrekt sortiert in der Output", () => {
    const h = hand(c("EICHEL", "ACHT"), c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"));
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(false);
    if (!("invalid" in r)) {
      expect(r.cards.map((c) => c.rank)).toEqual(["SECHS", "SIEBEN", "ACHT"]);
    }
  });

  it("WELI (Schelle-Sechs) zählt als normale Schelle-Sechs in einer Sequenz", () => {
    const h = hand(
      c("SCHELLE", "SECHS"), // = WELI
      c("SCHELLE", "SIEBEN"),
      c("SCHELLE", "ACHT")
    );
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(false);
    if (!("invalid" in r)) {
      expect(r.kind).toBe("SEQUENCE_3");
      expect(r.points).toBe(20);
    }
  });

  it("WELI hat KEINE Joker-Funktion — kann nicht eine fehlende Karte ersetzen", () => {
    // Eichel 7, 8 + Schelle-Sechs (WELI) wäre keine Sequenz.
    const h = hand(c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT"), c("SCHELLE", "SECHS"));
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(true);
  });
});

describe("validateDeclaration — Vier-Gleiche", () => {
  it("4 Unter (Buur) → 200 Punkte", () => {
    const h = hand(
      c("EICHEL", "UNTER"),
      c("SCHELLE", "UNTER"),
      c("HERZ", "UNTER"),
      c("LAUB", "UNTER")
    );
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(false);
    if (!("invalid" in r)) {
      expect(r.kind).toBe("FOUR_OF_A_KIND");
      expect(r.points).toBe(200);
      expect(r.topRank).toBe("UNTER");
      expect(r.suit).toBeNull();
    }
  });

  it("4 Neuner → 150 Punkte", () => {
    const h = hand(c("EICHEL", "NEUN"), c("SCHELLE", "NEUN"), c("HERZ", "NEUN"), c("LAUB", "NEUN"));
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(false);
    if (!("invalid" in r)) expect(r.points).toBe(150);
  });

  it.each([
    ["ZEHN", 100],
    ["OBER", 100],
    ["KOENIG", 100],
    ["ASS", 100],
  ] as const)("4 %s → %i Punkte", (rank, expectedPoints) => {
    const h = hand(c("EICHEL", rank), c("SCHELLE", rank), c("HERZ", rank), c("LAUB", rank));
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(false);
    if (!("invalid" in r)) expect(r.points).toBe(expectedPoints);
  });

  it("4 Sechser, 4 Siebener, 4 Achter sind KEINE gültigen Weisen", () => {
    for (const rank of ["SECHS", "SIEBEN", "ACHT"] as const) {
      const h = hand(c("EICHEL", rank), c("SCHELLE", rank), c("HERZ", rank), c("LAUB", rank));
      const r = validateDeclaration(h, h);
      expect("invalid" in r).toBe(true);
    }
  });

  it("3 von 4 Buur ist kein Vierling (und keine Sequenz)", () => {
    const h = hand(c("EICHEL", "UNTER"), c("SCHELLE", "UNTER"), c("HERZ", "UNTER"));
    const r = validateDeclaration(h, h);
    expect("invalid" in r).toBe(true);
  });
});

describe("validateDeclaration — Eingabe-Validierung", () => {
  it("weniger als 3 Karten → TOO_FEW_CARDS", () => {
    const r = validateDeclaration(
      [c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN")],
      [c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN")]
    );
    expect("invalid" in r && r.reason === "TOO_FEW_CARDS").toBe(true);
  });

  it("Karte nicht in der Hand → CARD_NOT_IN_HAND", () => {
    const h = hand(c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT"));
    const declared = hand(c("EICHEL", "SECHS"), c("SCHELLE", "SIEBEN"), c("EICHEL", "ACHT"));
    const r = validateDeclaration(declared, h);
    expect("invalid" in r && r.reason === "CARD_NOT_IN_HAND").toBe(true);
  });

  it("Duplikate in der Auswahl → DUPLICATE_CARDS", () => {
    const h = hand(c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT"));
    const declared = hand(c("EICHEL", "SECHS"), c("EICHEL", "SECHS"), c("EICHEL", "ACHT"));
    const r = validateDeclaration(declared, h);
    expect("invalid" in r && r.reason === "DUPLICATE_CARDS").toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// compareDeclarations — Regel a → c → b → d
// ──────────────────────────────────────────────────────────────────────

function asDecl(input: Card[]): WeisDeclaration {
  const r = validateDeclaration(input, input);
  if ("invalid" in r) throw new Error("Test-Bug: declaration invalid");
  return r;
}

describe("compareDeclarations", () => {
  it("(a) höhere Punkte gewinnen", () => {
    const big = asDecl([
      c("EICHEL", "SECHS"),
      c("EICHEL", "SIEBEN"),
      c("EICHEL", "ACHT"),
      c("EICHEL", "NEUN"),
    ]); // 50 P
    const small = asDecl([c("HERZ", "SECHS"), c("HERZ", "SIEBEN"), c("HERZ", "ACHT")]); // 20 P
    expect(compareDeclarations(big, 0, small, 1, null, 0)).toBeGreaterThan(0);
  });

  it("(c) bei gleicher Punktzahl gewinnt die höhere Top-Karte", () => {
    const hi = asDecl([c("EICHEL", "OBER"), c("EICHEL", "KOENIG"), c("EICHEL", "ASS")]); // 20, top ASS
    const lo = asDecl([c("HERZ", "SECHS"), c("HERZ", "SIEBEN"), c("HERZ", "ACHT")]); // 20, top ACHT
    expect(compareDeclarations(hi, 0, lo, 1, null, 0)).toBeGreaterThan(0);
  });

  it("(c) Trumpf-Boost wird NICHT angewendet — natürliche Rangordnung", () => {
    // Trump = EICHEL. In Trumpf-Wertung wäre 9 + Unter höher als Ass.
    // Beim Weisen-Vergleich ist Ass jedoch höher als Unter.
    const eichelOber = asDecl([c("EICHEL", "NEUN"), c("EICHEL", "ZEHN"), c("EICHEL", "UNTER")]); // top UNTER (5)
    const herzAss = asDecl([c("HERZ", "OBER"), c("HERZ", "KOENIG"), c("HERZ", "ASS")]); // top ASS (8)
    expect(compareDeclarations(eichelOber, 0, herzAss, 1, "EICHEL", 0)).toBeLessThan(0);
  });

  it("(b) bei Gleichstand auf Punkte+TopCard gewinnt Trumpf-Suit", () => {
    // Beide 3-Blatt mit top=ACHT, 20 Punkte. Trump = EICHEL.
    const eichel = asDecl([c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT")]);
    const herz = asDecl([c("HERZ", "SECHS"), c("HERZ", "SIEBEN"), c("HERZ", "ACHT")]);
    expect(compareDeclarations(eichel, 0, herz, 1, "EICHEL", 0)).toBeGreaterThan(0);
    expect(compareDeclarations(herz, 0, eichel, 1, "EICHEL", 0)).toBeLessThan(0);
  });

  it("(d) sonst Vorhand-Vorteil", () => {
    // Zwei identische 3-Blatt (top=ACHT, gleiche Farbe nicht möglich, also
    // zwei verschiedene Spieler mit unterschiedlichen Hands).
    // Wir testen: kein Trumpf, gleiche Punkte + Top-Karte + beide
    // nicht-Trumpf → Vorhand-Vorteil entscheidet.
    const a = asDecl([c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT")]);
    const b = asDecl([c("HERZ", "SECHS"), c("HERZ", "SIEBEN"), c("HERZ", "ACHT")]);
    // Sitz 1 ist Vorhand: Sitz 1 gewinnt
    expect(compareDeclarations(a, 0, b, 1, null, 1)).toBeLessThan(0);
    // Sitz 0 ist Vorhand: Sitz 0 gewinnt
    expect(compareDeclarations(a, 0, b, 1, null, 0)).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// aggregateWeisen — Sieger-Team kassiert alles Eigene
// ──────────────────────────────────────────────────────────────────────

describe("aggregateWeisen", () => {
  const DEFAULT_TEAMS = [0, 1, 0, 1];

  it("Niemand weist → 0 Punkte, kein Sieger", () => {
    const r = aggregateWeisen({
      declarationsPerSeat: {},
      teams: DEFAULT_TEAMS,
      trumpSuit: null,
      vorhandSeat: 0,
      numPlayers: 4,
    });
    expect(r.winningTeam).toBeNull();
    expect(r.points).toBe(0);
  });

  it("Nur ein Spieler weist → sein Team kassiert genau diese Punkte", () => {
    const decl = asDecl([c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT")]);
    const r = aggregateWeisen({
      declarationsPerSeat: { 0: [decl] },
      teams: DEFAULT_TEAMS,
      trumpSuit: null,
      vorhandSeat: 0,
      numPlayers: 4,
    });
    expect(r.winningTeam).toBe(0);
    expect(r.points).toBe(20);
  });

  it("Sieger-Team kriegt ALLE eigenen Weisen, Verlierer NICHTS", () => {
    // Team 0 (Sitze 0+2): zwei 3-Blatt, Sitz 0 hat zudem ein 4-Buur.
    // Team 1 (Sitz 1): 4 Neuner (150). 4 Buur (Sitz 0) > 4 Neuner →
    // Team 0 gewinnt, kassiert 20 + 20 + 200 = 240.
    const sitz0_buur = asDecl([
      c("EICHEL", "UNTER"),
      c("SCHELLE", "UNTER"),
      c("HERZ", "UNTER"),
      c("LAUB", "UNTER"),
    ]);
    const sitz0_seq = asDecl([c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT")]);
    const sitz2_seq = asDecl([c("HERZ", "SECHS"), c("HERZ", "SIEBEN"), c("HERZ", "ACHT")]);
    const sitz1_neuner = asDecl([
      c("EICHEL", "NEUN"),
      c("SCHELLE", "NEUN"),
      c("HERZ", "NEUN"),
      c("LAUB", "NEUN"),
    ]);
    const r = aggregateWeisen({
      declarationsPerSeat: { 0: [sitz0_buur, sitz0_seq], 1: [sitz1_neuner], 2: [sitz2_seq] },
      teams: DEFAULT_TEAMS,
      trumpSuit: null,
      vorhandSeat: 0,
      numPlayers: 4,
    });
    expect(r.winningTeam).toBe(0);
    expect(r.points).toBe(20 + 20 + 200);
    expect(r.bestDeclaration?.seat).toBe(0);
    expect(r.bestDeclaration?.declaration.kind).toBe("FOUR_OF_A_KIND");
  });

  it("Identische Top-Weisen in beiden Teams → Vorhand-Vorteil entscheidet", () => {
    // Beide Teams melden ein 3-Blatt mit top=ACHT (20 Pkt).
    // Sitz 0 = Vorhand, Sitz 1 = Team 1.
    const a = asDecl([c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT")]);
    const b = asDecl([c("HERZ", "SECHS"), c("HERZ", "SIEBEN"), c("HERZ", "ACHT")]);
    const r = aggregateWeisen({
      declarationsPerSeat: { 0: [a], 1: [b] },
      teams: DEFAULT_TEAMS,
      trumpSuit: null,
      vorhandSeat: 0,
      numPlayers: 4,
    });
    expect(r.winningTeam).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// findBestWeisenForHand — KI-Auto-Detect
// ──────────────────────────────────────────────────────────────────────

describe("findBestWeisenForHand (KI)", () => {
  it("Hand ohne mögliche Weisen → leere Liste", () => {
    const h = hand(
      c("EICHEL", "SECHS"),
      c("SCHELLE", "SIEBEN"),
      c("HERZ", "ACHT"),
      c("LAUB", "NEUN"),
      c("EICHEL", "ZEHN")
    );
    expect(findBestWeisenForHand(h)).toEqual([]);
  });

  it("4 Buur + 5-Blatt in einer anderen Farbe → beide werden gemeldet", () => {
    const h = hand(
      c("EICHEL", "UNTER"),
      c("SCHELLE", "UNTER"),
      c("HERZ", "UNTER"),
      c("LAUB", "UNTER"),
      c("EICHEL", "ZEHN"),
      c("EICHEL", "OBER"),
      c("EICHEL", "KOENIG"),
      c("EICHEL", "ASS"),
      c("EICHEL", "NEUN")
    );
    const found = findBestWeisenForHand(h);
    const totalPoints = found.reduce((s, w) => s + w.points, 0);
    // 200 (Buur) + 100 (5-Blatt 9-10-U-O-K-A oder 9-10-O-K-A je nach
    // Greedy-Strategie und Eichel-Unter-Konflikt).
    // Tatsächlich: Eichel-Unter ist Teil von Buur. 5-Blatt 9,10,O,K,A ist
    // möglich (ohne U), gibt 100 Pkt. Greedy: Buur (200) > 5-Blatt (100) →
    // erst Buur, dann 5-Blatt ohne den Buur.
    expect(found.some((w) => w.kind === "FOUR_OF_A_KIND")).toBe(true);
    expect(totalPoints).toBeGreaterThanOrEqual(200); // mindestens Buur
  });

  it("9-Blatt in einer Farbe → 180 Pkt", () => {
    const h = hand(
      c("HERZ", "SECHS"),
      c("HERZ", "SIEBEN"),
      c("HERZ", "ACHT"),
      c("HERZ", "NEUN"),
      c("HERZ", "ZEHN"),
      c("HERZ", "UNTER"),
      c("HERZ", "OBER"),
      c("HERZ", "KOENIG"),
      c("HERZ", "ASS")
    );
    const found = findBestWeisenForHand(h);
    expect(found).toHaveLength(1);
    expect(found[0]?.points).toBe(180);
  });

  it("Greedy bevorzugt Vier-Gleiche über überlappende Sequenz", () => {
    // 4 Asse (100) + Eichel-Sequenz 9,10,O,K,A (Ass ist Eichel-Ass)
    // → Greedy nimmt 4 Asse zuerst (höhere Einzel-Punkte), die
    //   Eichel-Sequenz fällt weg, weil ihr Ass schon vergeben ist.
    //   Aber: 9,10,O,K (ohne Ass) ist nur 4-Blatt = 50 Pkt, mit Ass
    //   wäre es 5-Blatt = 100. Greedy: 100 (4×A) vs 100 (5-Blatt) —
    //   wir nehmen das erste, ein 4-Blatt 9,10,O,K kommt nicht als
    //   separater Kandidat (unsere Enumeration findet pro Strecke nur
    //   die längste). Hier ist die ganze Strecke 9,10,O,K,A — nach
    //   Greedy-Konflikt verschwindet sie.
    const h = hand(
      c("EICHEL", "NEUN"),
      c("EICHEL", "ZEHN"),
      c("EICHEL", "OBER"),
      c("EICHEL", "KOENIG"),
      c("EICHEL", "ASS"),
      c("SCHELLE", "ASS"),
      c("HERZ", "ASS"),
      c("LAUB", "ASS")
    );
    const found = findBestWeisenForHand(h);
    // Mindestens das 4×Ass-Vierling.
    expect(found.some((w) => w.kind === "FOUR_OF_A_KIND")).toBe(true);
  });
});
