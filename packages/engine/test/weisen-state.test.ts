/**
 * Tests für die Weisen-Integration in den RoundState — Button-Click,
 * Submit, Window-Schließung, Auto-Aggregation nach Trick 1.
 */
import { describe, expect, it } from "vitest";

import {
  applyMove,
  clickWeisenButton,
  dealCards,
  handOf,
  newRound,
  submitWeisen,
  weisenSeatStatus,
  weisenWindowOpen,
  whoseTurn,
  InvalidMoveError,
  type RoundState,
} from "../src/state.js";
import { legalMoves } from "../src/rules.js";
import { validateDeclaration, type WeisDeclaration } from "../src/weisen.js";
import type { Announcement, Card, Variant } from "../src/types.js";

/** Spielt eine legale Karte für den aktuell-am-Zug-Sitz. Wartet nicht
 *  auf eine bestimmte Karte — nimmt einfach die erste legale. */
function playLegal(s: RoundState): RoundState {
  const seat = whoseTurn(s);
  const hand = handOf(s, seat);
  const legal = legalMoves(hand, s.current_trick_cards, s.variant);
  return applyMove(s, { seat, card: legal[0]! });
}

function seededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return ((state >>> 0) / 0x1_0000_0000) as number;
  };
}

const TRUMPF_EICHEL: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
const TRUMPF_EICHEL_ANN: Announcement = { variant: TRUMPF_EICHEL, slalom: false };
const c = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank });

/**
 * Konstruiert eine Hand mit garantiert 9 Karten: 4 Buur + 5 weitere
 * frei wählbare Karten. Für Sitz 0 verwenden wir das, damit wir Weisen
 * (4×U = 200 Pkt) deklarieren können.
 */
function handWith4BuurAnd5Filler(filler: Card[]): Card[] {
  return [
    c("EICHEL", "UNTER"),
    c("SCHELLE", "UNTER"),
    c("HERZ", "UNTER"),
    c("LAUB", "UNTER"),
    ...filler,
  ];
}

function freshGame(): RoundState {
  const hands = dealCards(seededRng(101));
  return newRound({
    variant: TRUMPF_EICHEL,
    announcement: TRUMPF_EICHEL_ANN,
    hands,
    starter: 0,
  });
}

describe("Weisen — Window-Berechnung", () => {
  it("Initial: alle Sitze sind PENDING (Window offen)", () => {
    const s = freshGame();
    for (let seat = 0; seat < 4; seat++) {
      expect(weisenSeatStatus(s, seat)).toBe("PENDING");
      expect(weisenWindowOpen(s, seat)).toBe(true);
    }
  });

  it("Nach Sitz 0 spielt, Sitz 1 noch nicht: Sitz 0 Window noch offen", () => {
    let s = freshGame();
    s = playLegal(s);
    expect(weisenWindowOpen(s, 0)).toBe(true);
    expect(weisenWindowOpen(s, 1)).toBe(true);
  });

  it("Nach Sitz 1 spielt: Sitz 0 Window ZU (next-in-line hat gespielt)", () => {
    let s = freshGame();
    s = playLegal(s); // seat 0
    s = playLegal(s); // seat 1
    expect(weisenWindowOpen(s, 0)).toBe(false);
    expect(weisenSeatStatus(s, 0)).toBe("MISSED");
    expect(weisenWindowOpen(s, 1)).toBe(true);
  });

  it("Nach Trick 1 abgeschlossen: alle Windows zu, evaluiert=true", () => {
    let s = freshGame();
    for (let i = 0; i < 4; i++) s = playLegal(s);
    expect(s.completed_tricks.length).toBe(1);
    expect(s.weisen_evaluated).toBe(true);
    for (let seat = 0; seat < 4; seat++) {
      expect(weisenSeatStatus(s, seat)).toBe("EVALUATED");
    }
  });
});

describe("Weisen — clickWeisenButton", () => {
  it("erlaubt Klick im offenen Fenster", () => {
    const s0 = freshGame();
    const s1 = clickWeisenButton(s0, 0, 12345);
    expect(s1.weisen_button_clicked_at[0]).toBe(12345);
    expect(weisenSeatStatus(s1, 0)).toBe("OPEN");
  });

  it("verweigert doppelten Klick", () => {
    const s0 = freshGame();
    const s1 = clickWeisenButton(s0, 0);
    expect(() => clickWeisenButton(s1, 0)).toThrow(InvalidMoveError);
  });

  it("verweigert Klick wenn Fenster zu (nächster Spieler hat gezogen)", () => {
    let s = freshGame();
    s = playLegal(s);
    s = playLegal(s);
    expect(() => clickWeisenButton(s, 0)).toThrow(InvalidMoveError);
  });
});

describe("Weisen — submitWeisen", () => {
  it("verweigert Submit ohne vorherigen Klick", () => {
    const s = freshGame();
    const decl = validateDeclaration(
      [c("EICHEL", "UNTER"), c("SCHELLE", "UNTER"), c("HERZ", "UNTER"), c("LAUB", "UNTER")],
      [c("EICHEL", "UNTER"), c("SCHELLE", "UNTER"), c("HERZ", "UNTER"), c("LAUB", "UNTER")]
    ) as WeisDeclaration;
    expect(() => submitWeisen(s, 0, [decl])).toThrow(/Button drücken/);
  });

  it("akzeptiert Submit nach Click — Deklaration wird gespeichert", () => {
    // Wir bauen eine maßgeschneiderte Hand für Sitz 0 mit den 4 Buur.
    const hands: Card[][] = [
      handWith4BuurAnd5Filler([
        c("EICHEL", "SECHS"),
        c("EICHEL", "SIEBEN"),
        c("EICHEL", "ACHT"),
        c("EICHEL", "NEUN"),
        c("EICHEL", "ZEHN"),
      ]),
      [
        c("SCHELLE", "SECHS"),
        c("SCHELLE", "SIEBEN"),
        c("SCHELLE", "ACHT"),
        c("SCHELLE", "NEUN"),
        c("SCHELLE", "ZEHN"),
        c("SCHELLE", "OBER"),
        c("SCHELLE", "KOENIG"),
        c("SCHELLE", "ASS"),
        c("EICHEL", "OBER"),
      ],
      [
        c("HERZ", "SECHS"),
        c("HERZ", "SIEBEN"),
        c("HERZ", "ACHT"),
        c("HERZ", "NEUN"),
        c("HERZ", "ZEHN"),
        c("HERZ", "OBER"),
        c("HERZ", "KOENIG"),
        c("HERZ", "ASS"),
        c("EICHEL", "KOENIG"),
      ],
      [
        c("LAUB", "SECHS"),
        c("LAUB", "SIEBEN"),
        c("LAUB", "ACHT"),
        c("LAUB", "NEUN"),
        c("LAUB", "ZEHN"),
        c("LAUB", "OBER"),
        c("LAUB", "KOENIG"),
        c("LAUB", "ASS"),
        c("EICHEL", "ASS"),
      ],
    ];
    let s = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 0,
    });

    const buurDecl = validateDeclaration(
      [c("EICHEL", "UNTER"), c("SCHELLE", "UNTER"), c("HERZ", "UNTER"), c("LAUB", "UNTER")],
      hands[0]!
    ) as WeisDeclaration;

    s = clickWeisenButton(s, 0);
    s = submitWeisen(s, 0, [buurDecl]);
    expect(s.weisen_declarations[0]).toHaveLength(1);
    expect(s.weisen_declarations[0]![0]?.points).toBe(200);
    expect(weisenSeatStatus(s, 0)).toBe("SUBMITTED");
  });

  it("verweigert Karten-Overlap zwischen mehreren Deklarationen", () => {
    const hand: Card[] = [
      c("EICHEL", "UNTER"),
      c("SCHELLE", "UNTER"),
      c("HERZ", "UNTER"),
      c("LAUB", "UNTER"),
      c("EICHEL", "SECHS"),
      c("EICHEL", "SIEBEN"),
      c("EICHEL", "ACHT"),
      c("EICHEL", "NEUN"),
      c("EICHEL", "ZEHN"),
    ];
    let s = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands: [hand, hand.slice(), hand.slice(), hand.slice()], // dummy 9-card hands
      starter: 0,
    });
    // ↑ Doppelte Karten in den Händen sind ok für diesen isolierten Test —
    // newRound validiert nur die Längen, nicht Unique-Cards.
    const seq = validateDeclaration(
      [c("EICHEL", "SECHS"), c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT")],
      hand
    ) as WeisDeclaration;
    const seqOverlap = validateDeclaration(
      [c("EICHEL", "SIEBEN"), c("EICHEL", "ACHT"), c("EICHEL", "NEUN")],
      hand
    ) as WeisDeclaration;
    s = clickWeisenButton(s, 0);
    expect(() => submitWeisen(s, 0, [seq, seqOverlap])).toThrow(/disjunkt/);
  });
});

describe("Weisen — Auto-Auswertung nach Trick 1", () => {
  /**
   * Spezielle Hände: Sitz 0 hat 4 Buur, deklariert das. Trick 1 wird
   * gespielt, alle 4 ziehen je eine Karte. Erwartung: nach Trick 1
   * werden 200 Punkte zu Team 0 (Sitze 0+2) addiert.
   */
  it("Sitz 0 weist 4 Buur, Team 0 kassiert 200 Punkte am Trick-1-Ende", () => {
    const hands: Card[][] = [
      [
        c("EICHEL", "UNTER"),
        c("SCHELLE", "UNTER"),
        c("HERZ", "UNTER"),
        c("LAUB", "UNTER"),
        c("EICHEL", "SECHS"),
        c("EICHEL", "SIEBEN"),
        c("EICHEL", "ACHT"),
        c("EICHEL", "NEUN"),
        c("EICHEL", "ZEHN"),
      ],
      [
        c("SCHELLE", "SECHS"),
        c("SCHELLE", "SIEBEN"),
        c("SCHELLE", "ACHT"),
        c("SCHELLE", "NEUN"),
        c("SCHELLE", "ZEHN"),
        c("SCHELLE", "OBER"),
        c("SCHELLE", "KOENIG"),
        c("SCHELLE", "ASS"),
        c("EICHEL", "OBER"),
      ],
      [
        c("HERZ", "SECHS"),
        c("HERZ", "SIEBEN"),
        c("HERZ", "ACHT"),
        c("HERZ", "NEUN"),
        c("HERZ", "ZEHN"),
        c("HERZ", "OBER"),
        c("HERZ", "KOENIG"),
        c("HERZ", "ASS"),
        c("EICHEL", "KOENIG"),
      ],
      [
        c("LAUB", "SECHS"),
        c("LAUB", "SIEBEN"),
        c("LAUB", "ACHT"),
        c("LAUB", "NEUN"),
        c("LAUB", "ZEHN"),
        c("LAUB", "OBER"),
        c("LAUB", "KOENIG"),
        c("LAUB", "ASS"),
        c("EICHEL", "ASS"),
      ],
    ];
    let s = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 0,
    });
    const buurDecl = validateDeclaration(
      [c("EICHEL", "UNTER"), c("SCHELLE", "UNTER"), c("HERZ", "UNTER"), c("LAUB", "UNTER")],
      hands[0]!
    ) as WeisDeclaration;
    s = clickWeisenButton(s, 0);
    s = submitWeisen(s, 0, [buurDecl]);

    // Trick 1 spielen — irgendeine legale Karte pro Sitz.
    for (let i = 0; i < 4; i++) s = playLegal(s);

    expect(s.completed_tricks.length).toBe(1);
    expect(s.weisen_evaluated).toBe(true);
    // Team 0 hat 200 Weisen-Punkte mehr als ohne Weisen.
    // Trick-1 selbst hat Karten-Wert-Punkte (Trumpf-Ober=14, König=4, Ass=11
    // + Eichel-Sechs=0 = 29 Punkte für den Trick-Gewinner — wer auch immer
    // das ist). Wir testen primär die 200er-Diff.
    const teamThatWonTrick1 = s.teams[s.trick_winners[0]!]!;
    if (teamThatWonTrick1 === 0) {
      // Team 0 hat sowohl Trick als auch Weisen — > 200
      expect(s.team_card_points[0]).toBeGreaterThanOrEqual(200);
      expect(s.team_card_points[1]).toBe(0);
    } else {
      // Team 1 hat den Trick, Team 0 hat nur die Weisen
      expect(s.team_card_points[0]).toBe(200);
      expect(s.team_card_points[1]).toBeGreaterThan(0);
    }
  });

  it("Niemand weist → keine Weisen-Punkte addiert", () => {
    let s = freshGame();
    for (let i = 0; i < 4; i++) s = playLegal(s);
    expect(s.weisen_evaluated).toBe(true);
    // Punkte sind nur die Trick-Karten-Werte (kein 200-er Weis).
    const totalPoints = s.team_card_points.reduce((a, b) => a + b, 0);
    expect(totalPoints).toBeLessThan(50); // grober Bound — Trick-1-Werte können nie 200+ sein
  });
});
