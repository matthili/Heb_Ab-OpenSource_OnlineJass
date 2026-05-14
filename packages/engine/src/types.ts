/**
 * Types und Konstanten des TS-Ports.
 *
 * Quelle der Wahrheit ist `external/jass-nn/jass_rules.json` (Schwester-Repo
 * jass-neuronales-netz, gepinnt via package.json#jassNn). Die hier hart kodierten
 * Werte werden im Test `rules-spec.consistency.test.ts` gegen die JSON-Spec
 * gegengeprüft — driftet eines, brechen die Tests.
 *
 * Wir spiegeln das Python-Modell aus jass_engine/card.py + variant.py + player.py
 * 1:1 in seinen Bezeichnern (`SUIT_ID`, `RANK_ID`, `PlayMode`, …). Bewusst keine
 * Re-Benennung, damit Cross-Referenzen Python↔TS einfach bleiben.
 */

// --- Suit / Rank als String-Unions ----------------------------------------
// Bewusst Strings statt numerischer Enums: die JSON-Fixtures benutzen die
// gleichen Namen ("EICHEL", "UNTER", …), also kein Mapper nötig beim Laden.
// Numerische IDs (für card_index = suit*9 + rank) liefern SUIT_ID/RANK_ID.

export type Suit = "EICHEL" | "SCHELLE" | "HERZ" | "LAUB";

export type Rank =
  | "SECHS"
  | "SIEBEN"
  | "ACHT"
  | "NEUN"
  | "ZEHN"
  | "UNTER"
  | "OBER"
  | "KOENIG"
  | "ASS";

export const SUITS: readonly Suit[] = ["EICHEL", "SCHELLE", "HERZ", "LAUB"];
export const RANKS: readonly Rank[] = [
  "SECHS",
  "SIEBEN",
  "ACHT",
  "NEUN",
  "ZEHN",
  "UNTER",
  "OBER",
  "KOENIG",
  "ASS",
];

export const SUIT_ID: Readonly<Record<Suit, number>> = {
  EICHEL: 0,
  SCHELLE: 1,
  HERZ: 2,
  LAUB: 3,
};

export const RANK_ID: Readonly<Record<Rank, number>> = {
  SECHS: 0,
  SIEBEN: 1,
  ACHT: 2,
  NEUN: 3,
  ZEHN: 4,
  UNTER: 5,
  OBER: 6,
  KOENIG: 7,
  ASS: 8,
};

// --- Card --------------------------------------------------------------------

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** Eindeutiger Index 0..35 einer Karte (für State-Encoder und Aktions-Maske). */
export type CardIndex = number;

// --- Variant / Announcement / GameState -------------------------------------

/**
 * Effektive Spielvariante für einen einzelnen Stich. Bei Slalom-Runden ist
 * `mode` immer OBEN oder UNTEN (nie ein abstraktes "SLALOM"); der Wechsel
 * wird vor dem Encoder aufgelöst und nur über `Announcement.slalom` markiert.
 */
export type PlayMode = "TRUMPF" | "OBEN" | "UNTEN";

export interface Variant {
  readonly mode: PlayMode;
  /** Pflicht bei `mode === "TRUMPF"`, andernfalls nicht gesetzt. */
  readonly trump_suit?: Suit;
}

export interface Announcement {
  readonly variant: Variant;
  /** True bei Slalom-Ansage; `variant.mode` ist dann der Startmodus. */
  readonly slalom: boolean;
}

/**
 * Vollständige Sicht, die ein Spieler beim Zug-Entscheid bekommt.
 *
 * Spiegelt 1:1 `jass_engine.player.GameState` aus dem NN-Repo, inklusive der
 * snake_case-Feldnamen (so passt die JSON-Deserialisierung der Fixtures ohne
 * Mapper).
 */
export interface GameState {
  readonly player_idx: number; // 0..3, absolute Position
  readonly variant: Variant; // pro-Stich-effektive Variante
  readonly announcement: Announcement;
  readonly current_trick_cards: readonly Card[];
  readonly current_trick_starter: number; // 0..3
  readonly teams: readonly number[]; // Default [0, 1, 0, 1]
  readonly completed_tricks: readonly (readonly Card[])[];
  readonly own_team_score: number;
  readonly opp_team_score: number;
  readonly round_idx: number;
  readonly trick_idx: number; // 0..8
  readonly num_players: number; // bei Kreuz-Jass 4
}

// --- Encoding-Konstanten -----------------------------------------------------

export const DECK_SIZE = 36;
export const NUM_PLAYERS = 4;
export const TRICKS_PER_ROUND = 9;
export const ACTION_DIM = 36;
export const STATE_DIM = 132;

/** Bezugs-Versionen aus `jass_rules.json` / `state_encoding.md`. */
export const SPEC_VERSION = "1.0.0";
export const ENCODING_VERSION = "1.0.0";

/** Sonderfall Weli: Schelle-Sechs (Index 9). Spielt nur in Runde 1 eine Rolle. */
export const WELI: Card = { suit: "SCHELLE", rank: "SECHS" };
export const WELI_INDEX: CardIndex = 9;

// --- Section-Offsets (132-dim Featurevektor) --------------------------------
// Aus state_encoding.md; aufsummierte Halb-offene Intervalle [start, end).

export type SectionName =
  | "own_hand"
  | "played_history"
  | "current_trick"
  | "lead_suit"
  | "trump_suit"
  | "mode"
  | "my_seat"
  | "starter_seat"
  | "score_own_norm"
  | "score_opp_norm"
  | "trick_idx_norm"
  | "round_idx_norm";

export const SECTION_OFFSETS: Readonly<Record<SectionName, readonly [number, number]>> = {
  own_hand: [0, 36],
  played_history: [36, 72],
  current_trick: [72, 108],
  lead_suit: [108, 112],
  trump_suit: [112, 116],
  mode: [116, 120],
  my_seat: [120, 124],
  starter_seat: [124, 128],
  score_own_norm: [128, 129],
  score_opp_norm: [129, 130],
  trick_idx_norm: [130, 131],
  round_idx_norm: [131, 132],
};

// --- Scoring-Konstanten ------------------------------------------------------

export const LAST_TRICK_BONUS = 5;
export const MATCH_BONUS = 100;
export const TOTAL_POINTS_PER_ROUND = 157; // 152 + 5 letzter Stich

/** Punktewerte, wenn die Variante TRUMPF gewählt ist und die Karte NICHT Trumpf ist. */
export const POINT_VALUES_NORMAL: Readonly<Record<Rank, number>> = {
  ASS: 11,
  ZEHN: 10,
  KOENIG: 4,
  OBER: 3,
  UNTER: 2,
  NEUN: 0,
  ACHT: 0,
  SIEBEN: 0,
  SECHS: 0,
};

/** Punktewerte für die Trumpf-Farbe (Buur = 20, Nell = 14). */
export const POINT_VALUES_TRUMP: Readonly<Record<Rank, number>> = {
  ASS: 11,
  ZEHN: 10,
  KOENIG: 4,
  OBER: 3,
  UNTER: 20,
  NEUN: 14,
  ACHT: 0,
  SIEBEN: 0,
  SECHS: 0,
};

/** Punktewerte bei Bock/Geiss/Slalom: kein Buur/Nell-Bonus, dafür 8 = 8. */
export const POINT_VALUES_OBEN_UNTEN: Readonly<Record<Rank, number>> = {
  ASS: 11,
  ZEHN: 10,
  KOENIG: 4,
  OBER: 3,
  UNTER: 2,
  ACHT: 8,
  NEUN: 0,
  SIEBEN: 0,
  SECHS: 0,
};

/**
 * Trumpf-Stichordnung: hoch → niedrig durch hohen Zahlenwert
 * (Buur=8 sticht alles, dann Nell=7, Ass=6, König=5, Ober=4, 10=3, 8=2, 7=1, 6=0).
 */
export const TRUMP_RANK_ORDER: Readonly<Record<Rank, number>> = {
  UNTER: 8,
  NEUN: 7,
  ASS: 6,
  KOENIG: 5,
  OBER: 4,
  ZEHN: 3,
  ACHT: 2,
  SIEBEN: 1,
  SECHS: 0,
};
