/**
 * Tests für state.ts — Round-Lifecycle, applyMove, Deal-/Shuffle-Logik.
 *
 * Reine Funktionen, deterministisch testbar; keine Compose/Docker-Abhängigkeit.
 */
import { describe, expect, it } from "vitest";

import type { RoundState } from "../src/state.js";
import {
  announceStoeck,
  applyMove,
  dealCards,
  DEFAULT_TEAMS,
  finalRoundScore,
  freshDeck,
  handOf,
  InvalidMoveError,
  isRoundDone,
  newRound,
  shuffleDeck,
  viewAsPlayer,
  whoseTurn,
} from "../src/state.js";
import type { Announcement, Card, Variant } from "../src/types.js";
import { DECK_SIZE, NUM_PLAYERS, RANKS, TRICKS_PER_ROUND } from "../src/types.js";

/** Deterministische LCG-RNG — gleiche Sequenz pro Seed. */
function seededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    // Mappe auf [0, 1) — 32-Bit-Wert unsigned dividieren.
    return ((state >>> 0) / 0x1_0000_0000) as number;
  };
}

const TRUMPF_EICHEL: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
const TRUMPF_EICHEL_ANN: Announcement = { variant: TRUMPF_EICHEL, slalom: false };

const c = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank });

// ─────────────────────────────────────────────────────────────────────
// Deck + Shuffle + Deal
// ─────────────────────────────────────────────────────────────────────

describe("freshDeck / shuffleDeck / dealCards", () => {
  it("freshDeck liefert genau 36 unique Karten", () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    const set = new Set(deck.map((c) => `${c.suit}-${c.rank}`));
    expect(set.size).toBe(DECK_SIZE);
  });

  it("shuffleDeck ist eine Permutation (kein Karten-Verlust)", () => {
    const original = freshDeck();
    const shuffled = shuffleDeck(original, seededRng(42));
    expect(shuffled).toHaveLength(DECK_SIZE);
    const setBefore = new Set(original.map((c) => `${c.suit}-${c.rank}`));
    const setAfter = new Set(shuffled.map((c) => `${c.suit}-${c.rank}`));
    expect(setAfter).toEqual(setBefore);
  });

  it("shuffleDeck mit gleichem Seed → identisches Ergebnis", () => {
    const a = shuffleDeck(freshDeck(), seededRng(123));
    const b = shuffleDeck(freshDeck(), seededRng(123));
    expect(a).toEqual(b);
  });

  it("shuffleDeck mit verschiedenen Seeds → verschiedenes Ergebnis", () => {
    const a = shuffleDeck(freshDeck(), seededRng(1));
    const b = shuffleDeck(freshDeck(), seededRng(2));
    expect(a).not.toEqual(b);
  });

  it("dealCards wirft, wenn DECK_SIZE nicht durch num_players teilbar ist", () => {
    expect(() => dealCards(seededRng(1), 5)).toThrow(/nicht teilbar/);
  });

  it("dealCards: 4 Hände à 9 Karten, zusammen genau das Deck", () => {
    const hands = dealCards(seededRng(7));
    expect(hands).toHaveLength(NUM_PLAYERS);
    expect(hands.every((h) => h.length === 9)).toBe(true);
    const all = hands.flat();
    expect(all).toHaveLength(DECK_SIZE);
    const set = new Set(all.map((c) => `${c.suit}-${c.rank}`));
    expect(set.size).toBe(DECK_SIZE);
  });
});

// ─────────────────────────────────────────────────────────────────────
// newRound + whoseTurn
// ─────────────────────────────────────────────────────────────────────

describe("newRound", () => {
  it("baut einen leeren Initial-State, Anspielen liegt beim starter", () => {
    const hands = dealCards(seededRng(11));
    const state = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 2,
    });
    expect(state.trick_idx).toBe(0);
    expect(state.current_trick_starter).toBe(2);
    expect(state.current_trick_cards).toEqual([]);
    expect(state.completed_tricks).toEqual([]);
    expect(state.team_card_points).toEqual([0, 0]);
    expect(state.trick_winners).toEqual([]);
    expect(whoseTurn(state)).toBe(2);
  });

  it("wirft bei falscher Hände-Anzahl", () => {
    const hands = dealCards(seededRng(13));
    expect(() =>
      newRound({
        variant: TRUMPF_EICHEL,
        announcement: TRUMPF_EICHEL_ANN,
        hands: hands.slice(0, 3),
        starter: 0,
      })
    ).toThrow(/erwartet 4/);
  });

  it("wirft bei Hand-Länge != 9", () => {
    const hands = dealCards(seededRng(17)).map((h, i) => (i === 0 ? h.slice(0, 8) : h));
    expect(() =>
      newRound({
        variant: TRUMPF_EICHEL,
        announcement: TRUMPF_EICHEL_ANN,
        hands,
        starter: 0,
      })
    ).toThrow(/Hand 0 hat 8/);
  });

  it("wirft bei out-of-range starter", () => {
    const hands = dealCards(seededRng(19));
    expect(() =>
      newRound({
        variant: TRUMPF_EICHEL,
        announcement: TRUMPF_EICHEL_ANN,
        hands,
        starter: 4,
      })
    ).toThrow(/starter 4/);
  });
});

describe("whoseTurn", () => {
  it("rotiert (starter + cards_played) mod 4 durch den Stich", () => {
    const hands = dealCards(seededRng(2));
    let s = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 1,
    });
    expect(whoseTurn(s)).toBe(1);

    // legale erste Karte pro Sitz wählen — die jeweilige Lead-/Farbzwang-Logik
    // wird durch legalMoves() berücksichtigt.
    for (const expectedNext of [2, 3, 0]) {
      const seat = whoseTurn(s);
      const legal = legalMoves(handOf(s, seat), s.current_trick_cards, s.variant);
      s = applyMove(s, { seat, card: legal[0]! });
      expect(whoseTurn(s)).toBe(expectedNext);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// applyMove — Validierung
// ─────────────────────────────────────────────────────────────────────

describe("applyMove — Validierung", () => {
  function freshState(): RoundState {
    return newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands: dealCards(seededRng(101)),
      starter: 0,
    });
  }

  it("wirft, wenn der falsche Sitz zieht", () => {
    const s = freshState();
    expect(() => applyMove(s, { seat: 1, card: s.hands[1]![0]! })).toThrow(InvalidMoveError);
  });

  it("wirft, wenn die Karte nicht in der Hand ist", () => {
    const s = freshState();
    // Eine Karte, die garantiert nicht in der Hand von Sitz 0 ist (keine
    // dieser zufälligen Hände hat alle Karten):
    const notInHand =
      s.hands[0]!.length > 0 ? findCardNotInHand(s.hands[0]!) : c("EICHEL", "SECHS");
    expect(() => applyMove(s, { seat: 0, card: notInHand })).toThrow(/not in hand/);
  });

  it("wirft, wenn der Move kein legaler Zug ist (Farbzwang)", () => {
    // Konstruieren wir eine spezifische Hand mit Bedien-Pflicht.
    const hands: Card[][] = [
      [c("HERZ", "ASS"), c("LAUB", "SIEBEN"), ...repeatCard(c("EICHEL", "ACHT"), 7)],
      Array.from({ length: 9 }, (_, i) => c("LAUB", RANKS[i]!)),
      Array.from({ length: 9 }, (_, i) => c("SCHELLE", RANKS[i]!)),
      Array.from({ length: 9 }, (_, i) => c("HERZ", RANKS[i]!)),
    ];
    // Trick startet bei Sitz 1, der spielt LAUB. Sitz 2 hat keine LAUB → ok.
    // Wir prüfen, dass Sitz 0 nach LAUB-Lead seine LAUB bedienen MUSS.
    let s = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 1,
    });
    s = applyMove(s, { seat: 1, card: c("LAUB", "ZEHN") });
    s = applyMove(s, { seat: 2, card: c("SCHELLE", "ASS") });
    s = applyMove(s, { seat: 3, card: c("HERZ", "OBER") });
    // Jetzt Sitz 0 mit Hand inkl. LAUB-7 — er DARF nicht HERZ-ASS spielen,
    // weil LAUB bedienbar ist (Eichel ist Trumpf, aber keine Buur-Ausnahme).
    expect(() => applyMove(s, { seat: 0, card: c("HERZ", "ASS") })).toThrow(/legal move/);
    // LAUB-7 ist legal.
    expect(() => applyMove(s, { seat: 0, card: c("LAUB", "SIEBEN") })).not.toThrow();
  });

  it("wirft, wenn die Runde schon vorbei ist", () => {
    // 9-Tricks-Mock: wir simulieren einen End-State mit completed_tricks.length=9.
    const hands = dealCards(seededRng(31));
    const start = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 0,
    });
    const doneState: RoundState = {
      ...start,
      completed_tricks: new Array(TRICKS_PER_ROUND).fill({
        starter: 0,
        cards: [c("EICHEL", "SECHS")],
      }),
      hands: hands.map(() => []),
    };
    expect(isRoundDone(doneState)).toBe(true);
    expect(() => applyMove(doneState, { seat: 0, card: c("EICHEL", "ASS") })).toThrow(
      /already finished/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// applyMove — Trick-Abschluss und Score-Tracking
// ─────────────────────────────────────────────────────────────────────

describe("applyMove — Trick-Abschluss", () => {
  it("schließt den Trick nach der 4. Karte ab und führt Score nach", () => {
    // Konstruierte Hände: Sitz 0 bekommt Trumpf-Ass (Eichel-Ass), Sitz 1 die
    // niedrigsten Karten, Sitz 2 ebenfalls niedrig, Sitz 3 niedrig → Sitz 0
    // gewinnt den Eröffnungs-Trick mit Trumpf-Ass (11 Punkte).
    const hands: Card[][] = [
      [
        c("EICHEL", "ASS"),
        c("HERZ", "SECHS"),
        c("HERZ", "SIEBEN"),
        c("HERZ", "ACHT"),
        c("HERZ", "NEUN"),
        c("HERZ", "ZEHN"),
        c("HERZ", "UNTER"),
        c("HERZ", "OBER"),
        c("HERZ", "KOENIG"),
      ],
      Array.from({ length: 9 }, (_, i) => c("LAUB", RANKS[i]!)),
      Array.from({ length: 9 }, (_, i) => c("SCHELLE", RANKS[i]!)),
      [
        c("EICHEL", "SECHS"),
        c("EICHEL", "SIEBEN"),
        c("EICHEL", "ACHT"),
        c("EICHEL", "NEUN"),
        c("EICHEL", "ZEHN"),
        c("EICHEL", "UNTER"),
        c("EICHEL", "OBER"),
        c("EICHEL", "KOENIG"),
        c("HERZ", "ASS"),
      ],
    ];
    let s = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 0,
    });
    s = applyMove(s, { seat: 0, card: c("EICHEL", "ASS") });
    s = applyMove(s, { seat: 1, card: c("LAUB", "SECHS") });
    s = applyMove(s, { seat: 2, card: c("SCHELLE", "SECHS") });
    // Sitz 3 muss Trumpf bedienen — er hat Eichel-Karten. Wegen
    // Kein-Untertrumpfen-Verbot und weil EICHEL-ASS schon liegt (rank-order 6),
    // muss er einen höheren Trumpf spielen — Buur (Eichel-UNTER, rank-order 8)
    // oder Nell (Eichel-NEUN, rank-order 7).
    s = applyMove(s, { seat: 3, card: c("EICHEL", "UNTER") });

    // Trick abgeschlossen
    expect(s.current_trick_cards).toEqual([]);
    expect(s.completed_tricks).toHaveLength(1);
    expect(s.trick_idx).toBe(1);

    // Gewinner: Buur (Eichel-Unter, höchster Trumpf) → Sitz 3, Team 1
    expect(s.trick_winners).toEqual([3]);
    // Punkte: Trumpf-Ass 11 + Buur 20 + 2 × 0 = 31 zum Team 1
    expect(s.team_card_points).toEqual([0, 31]);
    // Nächster Starter = Trick-Gewinner
    expect(s.current_trick_starter).toBe(3);
    expect(whoseTurn(s)).toBe(3);
  });

  it("addiert +5 für den letzten (neunten) Stich", () => {
    // Wir mocken einen RoundState der kurz vor dem letzten Stich steht, mit
    // bekannten Karten. Alle vorherigen 8 Tricks setzen wir leer/synthetisch.
    const lastTrickHands: Card[][] = [
      [c("EICHEL", "SECHS")],
      [c("LAUB", "SECHS")],
      [c("SCHELLE", "SECHS")],
      [c("HERZ", "SECHS")],
    ];
    // Synthetische Vorgeschichte: 8 leere Tricks, damit isLastTrick=true beim
    // 9. greift.
    const fakePrevious = new Array(8).fill(0).map((_, i) => ({
      starter: i % 4,
      cards: [c("EICHEL", "ASS")] as readonly Card[],
    }));
    const state: RoundState = {
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      teams: DEFAULT_TEAMS,
      num_players: 4,
      round_idx: 0,
      hands: lastTrickHands,
      trick_idx: 8,
      current_trick_starter: 0,
      current_trick_cards: [],
      completed_tricks: fakePrevious,
      team_card_points: [0, 0],
      trick_winners: [0, 0, 0, 0, 0, 0, 0, 0],
      stoeck_eligible_seat: null,
      stoeck_announced_team: null,
      weisen_button_clicked_at: [null, null, null, null],
      weisen_declarations: [[], [], [], []],
      weisen_evaluated: false,
    };
    let s = applyMove(state, { seat: 0, card: c("EICHEL", "SECHS") });
    s = applyMove(s, { seat: 1, card: c("LAUB", "SECHS") });
    s = applyMove(s, { seat: 2, card: c("SCHELLE", "SECHS") });
    s = applyMove(s, { seat: 3, card: c("HERZ", "SECHS") });

    expect(isRoundDone(s)).toBe(true);
    // Trump-6 hat 0 Punkte, andere 6er auch 0 — also gewinnt der einzige
    // Trumpf (Eichel-Sechs, Sitz 0). Punkte: 0 + 0 + 0 + 0 + 5 Letzter-Bonus.
    expect(s.team_card_points[0]).toBe(5);
    expect(s.team_card_points[1]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// finalRoundScore + Matsch
// ─────────────────────────────────────────────────────────────────────

describe("finalRoundScore", () => {
  it("wirft, solange die Runde nicht zu Ende ist", () => {
    const s = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands: dealCards(seededRng(7)),
      starter: 0,
    });
    expect(() => finalRoundScore(s)).toThrow(/not finished/);
  });

  it("erkennt Matsch, wenn ein Team alle 9 Stiche gewonnen hat", () => {
    const s: RoundState = {
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      teams: DEFAULT_TEAMS,
      num_players: 4,
      round_idx: 0,
      hands: [[], [], [], []],
      trick_idx: 9,
      current_trick_starter: 0,
      current_trick_cards: [],
      completed_tricks: new Array(9).fill({ starter: 0, cards: [c("EICHEL", "ASS")] }),
      team_card_points: [157, 0], // Team 0 hat alles
      trick_winners: [0, 2, 0, 2, 0, 2, 0, 2, 0], // alle aus Team 0
      stoeck_eligible_seat: null,
      stoeck_announced_team: null,
      weisen_button_clicked_at: [null, null, null, null],
      weisen_declarations: [[], [], [], []],
      weisen_evaluated: false,
    };
    const score = finalRoundScore(s);
    expect(score.matsch_team).toBe(0);
    // Matsch-Bonus +100 wird zu den team_card_points des Sieger-Teams
    // dazugerechnet → 157 + 100 = 257 (NN-Spec score_composition).
    expect(score.team_card_points).toEqual([257, 0]);
  });

  it("liefert matsch_team=null bei geteiltem Spiel", () => {
    const s: RoundState = {
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      teams: DEFAULT_TEAMS,
      num_players: 4,
      round_idx: 0,
      hands: [[], [], [], []],
      trick_idx: 9,
      current_trick_starter: 0,
      current_trick_cards: [],
      completed_tricks: new Array(9).fill({ starter: 0, cards: [c("EICHEL", "ASS")] }),
      team_card_points: [80, 77],
      trick_winners: [0, 1, 0, 1, 0, 1, 0, 1, 0],
      stoeck_eligible_seat: null,
      stoeck_announced_team: null,
      weisen_button_clicked_at: [null, null, null, null],
      weisen_declarations: [[], [], [], []],
      weisen_evaluated: false,
    };
    expect(finalRoundScore(s).matsch_team).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Stöck
// ─────────────────────────────────────────────────────────────────────

describe("Stöck", () => {
  /**
   * Hand-Setup: Sitz 0 hat Trumpf-OBER + Trumpf-KOENIG (Eichel-Trumpf).
   * Beim Ausspielen der zweiten der beiden Karten wird er
   * `stoeck_eligible_seat`. Sagt er sofort an, bekommt sein Team
   * +20 Punkte am Rundenende.
   */
  function setupStoeckRound(handsOverride?: Card[][]): RoundState {
    // Hand 0 enthält OBER+KOENIG Eichel; Hände 1..3 mit Füllkarten.
    const hands: Card[][] = handsOverride ?? [
      [
        c("EICHEL", "OBER"),
        c("EICHEL", "KOENIG"),
        c("EICHEL", "SECHS"),
        c("EICHEL", "SIEBEN"),
        c("EICHEL", "ACHT"),
        c("EICHEL", "NEUN"),
        c("EICHEL", "ZEHN"),
        c("EICHEL", "UNTER"),
        c("EICHEL", "ASS"),
      ],
      [
        c("HERZ", "SECHS"),
        c("HERZ", "SIEBEN"),
        c("HERZ", "ACHT"),
        c("HERZ", "NEUN"),
        c("HERZ", "ZEHN"),
        c("HERZ", "UNTER"),
        c("HERZ", "OBER"),
        c("HERZ", "KOENIG"),
        c("HERZ", "ASS"),
      ],
      [
        c("LAUB", "SECHS"),
        c("LAUB", "SIEBEN"),
        c("LAUB", "ACHT"),
        c("LAUB", "NEUN"),
        c("LAUB", "ZEHN"),
        c("LAUB", "UNTER"),
        c("LAUB", "OBER"),
        c("LAUB", "KOENIG"),
        c("LAUB", "ASS"),
      ],
      [
        c("SCHELLE", "SIEBEN"),
        c("SCHELLE", "ACHT"),
        c("SCHELLE", "NEUN"),
        c("SCHELLE", "ZEHN"),
        c("SCHELLE", "UNTER"),
        c("SCHELLE", "OBER"),
        c("SCHELLE", "KOENIG"),
        c("SCHELLE", "ASS"),
        c("SCHELLE", "SECHS"), // WELI
      ],
    ];
    return newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 0,
    });
  }

  it("setzt stoeck_eligible_seat, sobald Spieler die zweite Stöck-Karte spielt", () => {
    let s = setupStoeckRound();
    // Trick 1: Sitz 0 spielt OBER (1. Stöck-Karte) → eligible bleibt null.
    s = applyMove(s, { seat: 0, card: c("EICHEL", "OBER") });
    expect(s.stoeck_eligible_seat).toBeNull();
    // Sitz 1,2,3 bedienen mit beliebigen Karten.
    s = applyMove(s, { seat: 1, card: c("HERZ", "SECHS") });
    s = applyMove(s, { seat: 2, card: c("LAUB", "SECHS") });
    s = applyMove(s, { seat: 3, card: c("SCHELLE", "SIEBEN") });
    // Trick 2 — Sitz 0 hat gewonnen (Eichel-Trumpf-OBER schlägt alle non-Trump)
    // und spielt nun KOENIG (2. Stöck-Karte) → eligible = 0.
    s = applyMove(s, { seat: 0, card: c("EICHEL", "KOENIG") });
    expect(s.stoeck_eligible_seat).toBe(0);
    expect(s.stoeck_announced_team).toBeNull();
  });

  it("addiert +20 ans Team, wenn Stöck angesagt wird", () => {
    let s = setupStoeckRound();
    s = applyMove(s, { seat: 0, card: c("EICHEL", "OBER") });
    s = applyMove(s, { seat: 1, card: c("HERZ", "SECHS") });
    s = applyMove(s, { seat: 2, card: c("LAUB", "SECHS") });
    s = applyMove(s, { seat: 3, card: c("SCHELLE", "SIEBEN") });
    s = applyMove(s, { seat: 0, card: c("EICHEL", "KOENIG") });
    expect(s.stoeck_eligible_seat).toBe(0);

    // Spieler sagt an.
    s = announceStoeck(s, 0);
    expect(s.stoeck_announced_team).toBe(0);
    expect(s.stoeck_eligible_seat).toBeNull();
  });

  it("verfallt die Frist, wenn der eligible Sitz seinen NÄCHSTEN Zug macht ohne anzusagen", () => {
    let s = setupStoeckRound();
    s = applyMove(s, { seat: 0, card: c("EICHEL", "OBER") });
    s = applyMove(s, { seat: 1, card: c("HERZ", "SECHS") });
    s = applyMove(s, { seat: 2, card: c("LAUB", "SECHS") });
    s = applyMove(s, { seat: 3, card: c("SCHELLE", "SIEBEN") });
    s = applyMove(s, { seat: 0, card: c("EICHEL", "KOENIG") });
    expect(s.stoeck_eligible_seat).toBe(0);
    // Trick fortsetzen — Sitz 1/2/3 ziehen.
    s = applyMove(s, { seat: 1, card: c("HERZ", "SIEBEN") });
    s = applyMove(s, { seat: 2, card: c("LAUB", "SIEBEN") });
    s = applyMove(s, { seat: 3, card: c("SCHELLE", "ACHT") });
    // Sitz 0 ist wieder dran (Trick-Sieger). Eligibility besteht weiter.
    expect(s.stoeck_eligible_seat).toBe(0);
    // Sitz 0 spielt seinen nächsten Zug ohne Ansage → Frist verfallen.
    s = applyMove(s, { seat: 0, card: c("EICHEL", "SECHS") });
    expect(s.stoeck_eligible_seat).toBeNull();
    expect(s.stoeck_announced_team).toBeNull();
  });

  it("verweigert announceStoeck, wenn nicht eligible", () => {
    let s = setupStoeckRound();
    s = applyMove(s, { seat: 0, card: c("EICHEL", "OBER") });
    // Noch keine 2. Karte → niemand eligible.
    expect(() => announceStoeck(s, 0)).toThrow(InvalidMoveError);
  });

  it("verweigert doppeltes Ansagen", () => {
    let s = setupStoeckRound();
    s = applyMove(s, { seat: 0, card: c("EICHEL", "OBER") });
    s = applyMove(s, { seat: 1, card: c("HERZ", "SECHS") });
    s = applyMove(s, { seat: 2, card: c("LAUB", "SECHS") });
    s = applyMove(s, { seat: 3, card: c("SCHELLE", "SIEBEN") });
    s = applyMove(s, { seat: 0, card: c("EICHEL", "KOENIG") });
    s = announceStoeck(s, 0);
    expect(() => announceStoeck(s, 0)).toThrow(/bereits/);
  });

  it("addiert +20 in finalRoundScore, wenn Stöck angesagt wurde", () => {
    // Fertige Runde mit Stöck-Ansage simulieren.
    const s: RoundState = {
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      teams: DEFAULT_TEAMS,
      num_players: 4,
      round_idx: 0,
      hands: [[], [], [], []],
      trick_idx: 9,
      current_trick_starter: 0,
      current_trick_cards: [],
      completed_tricks: new Array(9).fill({ starter: 0, cards: [c("EICHEL", "ASS")] }),
      team_card_points: [80, 77],
      trick_winners: [0, 1, 0, 1, 0, 1, 0, 1, 0],
      stoeck_eligible_seat: null,
      stoeck_announced_team: 0,
      weisen_button_clicked_at: [null, null, null, null],
      weisen_declarations: [[], [], [], []],
      weisen_evaluated: true,
    };
    const score = finalRoundScore(s);
    expect(score.team_card_points).toEqual([100, 77]); // 80 + 20 Stöck
  });

  it("greift NICHT in OBEN/UNTEN-Spielen", () => {
    const obenHands: Card[][] = [
      [
        c("EICHEL", "OBER"),
        c("EICHEL", "KOENIG"),
        c("EICHEL", "SECHS"),
        c("EICHEL", "SIEBEN"),
        c("EICHEL", "ACHT"),
        c("EICHEL", "NEUN"),
        c("EICHEL", "ZEHN"),
        c("EICHEL", "UNTER"),
        c("EICHEL", "ASS"),
      ],
      [
        c("HERZ", "SECHS"),
        c("HERZ", "SIEBEN"),
        c("HERZ", "ACHT"),
        c("HERZ", "NEUN"),
        c("HERZ", "ZEHN"),
        c("HERZ", "UNTER"),
        c("HERZ", "OBER"),
        c("HERZ", "KOENIG"),
        c("HERZ", "ASS"),
      ],
      [
        c("LAUB", "SECHS"),
        c("LAUB", "SIEBEN"),
        c("LAUB", "ACHT"),
        c("LAUB", "NEUN"),
        c("LAUB", "ZEHN"),
        c("LAUB", "UNTER"),
        c("LAUB", "OBER"),
        c("LAUB", "KOENIG"),
        c("LAUB", "ASS"),
      ],
      [
        c("SCHELLE", "SIEBEN"),
        c("SCHELLE", "ACHT"),
        c("SCHELLE", "NEUN"),
        c("SCHELLE", "ZEHN"),
        c("SCHELLE", "UNTER"),
        c("SCHELLE", "OBER"),
        c("SCHELLE", "KOENIG"),
        c("SCHELLE", "ASS"),
        c("SCHELLE", "SECHS"),
      ],
    ];
    const obenVariant: Variant = { mode: "OBEN" };
    let s = newRound({
      variant: obenVariant,
      announcement: { variant: obenVariant, slalom: false },
      hands: obenHands,
      starter: 0,
    });
    s = applyMove(s, { seat: 0, card: c("EICHEL", "OBER") });
    s = applyMove(s, { seat: 1, card: c("HERZ", "SECHS") });
    s = applyMove(s, { seat: 2, card: c("LAUB", "SECHS") });
    s = applyMove(s, { seat: 3, card: c("SCHELLE", "SIEBEN") });
    s = applyMove(s, { seat: 0, card: c("EICHEL", "KOENIG") });
    expect(s.stoeck_eligible_seat).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// viewAsPlayer
// ─────────────────────────────────────────────────────────────────────

describe("viewAsPlayer", () => {
  it("liefert einen GameState mit korrekter Perspektive + own/opp-Scores", () => {
    const hands = dealCards(seededRng(5));
    const state: RoundState = {
      ...newRound({
        variant: TRUMPF_EICHEL,
        announcement: TRUMPF_EICHEL_ANN,
        hands,
        starter: 0,
      }),
      team_card_points: [42, 17],
    };
    const view0 = viewAsPlayer(state, 0); // Team 0
    expect(view0.player_idx).toBe(0);
    expect(view0.own_team_score).toBe(42);
    expect(view0.opp_team_score).toBe(17);

    const view1 = viewAsPlayer(state, 1); // Team 1
    expect(view1.own_team_score).toBe(17);
    expect(view1.opp_team_score).toBe(42);
  });

  it("enthält KEINE fremden Hände im GameState (Anti-Cheat-Pfad)", () => {
    const hands = dealCards(seededRng(9));
    const state = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 0,
    });
    const view = viewAsPlayer(state, 0);
    // GameState hat keine `hands`-Property — explizit prüfen.
    expect("hands" in view).toBe(false);
    // Die echte Hand kriegt der Client separat über handOf().
    const myHand = handOf(state, 0);
    expect(myHand).toHaveLength(9);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Integration: kompletter 4-Bot-Random-Lauf
// ─────────────────────────────────────────────────────────────────────

describe("Integration: 9-Tricks-Lauf bis isRoundDone", () => {
  it("spielt 4 Random-Bots eine komplette Runde — 9 Tricks, Punkte-Summe = 157", () => {
    const rng = seededRng(2026);
    const hands = dealCards(rng);
    let s = newRound({
      variant: TRUMPF_EICHEL,
      announcement: TRUMPF_EICHEL_ANN,
      hands,
      starter: 0,
    });

    while (!isRoundDone(s)) {
      const seat = whoseTurn(s);
      const hand = handOf(s, seat);
      // Naiv: erste legale Karte. legalMoves prüft Farbzwang.
      const legal = legalMovesFromHand(hand, s);
      const card = legal[Math.floor(rng() * legal.length)] as Card;
      s = applyMove(s, { seat, card });
    }

    expect(s.completed_tricks).toHaveLength(TRICKS_PER_ROUND);
    expect(s.trick_winners).toHaveLength(TRICKS_PER_ROUND);
    expect(s.hands.every((h) => h.length === 0)).toBe(true);

    const score = finalRoundScore(s);
    const sumPoints = score.team_card_points.reduce((a, b) => a + b, 0);
    // 152 Karten-Punkte + 5 Letzter-Stich-Bonus = 157, ohne Matsch-Bonus.
    expect(sumPoints).toBe(157);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function repeatCard(card: Card, n: number): Card[] {
  return new Array(n).fill(card);
}

function findCardNotInHand(hand: readonly Card[]): Card {
  const setKey = (c: Card) => `${c.suit}-${c.rank}`;
  const have = new Set(hand.map(setKey));
  for (const s of ["EICHEL", "SCHELLE", "HERZ", "LAUB"] as const) {
    for (const r of RANKS) {
      const cc: Card = { suit: s, rank: r };
      if (!have.has(setKey(cc))) return cc;
    }
  }
  throw new Error("Hand enthält bereits alle 36 Karten");
}

import { legalMoves } from "../src/rules.js";
function legalMovesFromHand(hand: readonly Card[], state: RoundState) {
  return legalMoves(hand, state.current_trick_cards, state.variant);
}
