/**
 * Types und Konstanten des TS-Ports.
 *
 * Quelle der Wahrheit ist `external/jass-nn/jass_rules.json` (Schwester-Repo
 * jass-neuronales-netz, gepinnt via package.json#jassNn). Die hier hart kodierten
 * Werte werden im Test `rules-spec.consistency.test.ts` gegen die JSON-Spec
 * gegengeprüft — driftet eines, brechen die Tests.
 *
 * **Stand: Spec 1.1.0 / Encoding 3.0.0** (Release v0.5.0 des NN-Repos).
 * Encoding-Layout: 20 Sections, 421 dims insgesamt, per-Spieler-positionierte
 * History, vorberechnete `value_per_card` und `strength_per_card`, 5-dim Mode
 * (zusätzlich `is_gumpf`).
 */

// --- Suit / Rank als String-Unions ----------------------------------------

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

/** Eindeutiger Index 0..35 einer Karte. */
export type CardIndex = number;

// --- Variant / Announcement / GameState -------------------------------------

/**
 * Effektive Spielvariante für einen einzelnen Stich. Bei Slalom-Runden ist
 * `mode` immer OBEN oder UNTEN (nie ein abstraktes "SLALOM"); der Wechsel
 * wird vor dem Encoder aufgelöst und nur über `Announcement.slalom` markiert.
 *
 * **GUMPF** (neu in Spec 1.1.0):
 *   - Trumpf-Farbe verhält sich wie bei `TRUMPF` (Buur=20, Nell=14,
 *     Buur-Ausnahme, kein-Untertrumpfen, Stöcke).
 *   - Nicht-Trumpf-Farben haben invertierte Stich-Stärke wie bei `UNTEN`
 *     (die 6 in der Lead-Farbe sticht alles).
 *   - Wertpunkte in Nicht-Trumpf bleiben wie bei `TRUMPF` (8er = 0, kein
 *     Geiss-8er-Bonus).
 *   - Slalom darf NICHT mit Gumpf kombiniert werden.
 */
export type PlayMode = "TRUMPF" | "GUMPF" | "OBEN" | "UNTEN";

export interface Variant {
  readonly mode: PlayMode;
  /** Pflicht bei `mode === "TRUMPF" | "GUMPF"`, andernfalls nicht gesetzt. */
  readonly trump_suit?: Suit;
}

export interface Announcement {
  readonly variant: Variant;
  /**
   * True bei Slalom-Ansage; `variant.mode` ist dann der Startmodus (OBEN oder
   * UNTEN). Pro Stich wird der Modus alterniert.
   *
   * **Constraint**: bei `variant.mode === "TRUMPF" | "GUMPF"` muss
   * `slalom === false` sein. Wird in der GameState-Builder-Logik validiert
   * (kommt mit M4).
   */
  readonly slalom: boolean;
}

/**
 * Ein abgeschlossener Stich inklusive Starter, damit der Encoder pro Karte
 * den Spieler-Index rekonstruieren kann.
 */
export interface CompletedTrick {
  readonly starter: number; // 0..3, absolute Sitz-Position
  readonly cards: readonly Card[];
}

/**
 * Vollständige Sicht, die ein Spieler beim Zug-Entscheid bekommt.
 *
 * Spiegelt `jass_engine.player.GameState` aus dem NN-Repo (Spec 1.1.0).
 * snake_case-Feldnamen bleiben aus Interop-Gründen erhalten — Fixture-JSON
 * wird ohne Mapper deserialisierbar.
 */
export interface GameState {
  readonly player_idx: number; // 0..3, absolute Position
  readonly variant: Variant; // pro-Stich-effektive Variante
  readonly announcement: Announcement;
  readonly current_trick_cards: readonly Card[];
  readonly current_trick_starter: number; // 0..3
  readonly teams: readonly number[]; // Default [0, 1, 0, 1]
  readonly completed_tricks: readonly CompletedTrick[];
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
export const STATE_DIM = 421;

/** Bezugs-Versionen aus `jass_rules.json` / `state_encoding.md`. */
export const SPEC_VERSION = "1.1.0";
export const ENCODING_VERSION = "3.0.0";

/** Sonderfall Weli: Schelle-Sechs (Index 9). Spielt nur in Runde 1 eine Rolle. */
export const WELI: Card = { suit: "SCHELLE", rank: "SECHS" };
export const WELI_INDEX: CardIndex = 9;

// --- Section-Offsets (421-dim Featurevektor, Encoding v3.0.0) ---------------
// Aus state_encoding.md, halboffene Intervalle [start, end).

export type SectionName =
  | "own_hand"
  | "played_by_me"
  | "played_by_left"
  | "played_by_partner"
  | "played_by_right"
  | "current_trick_by_me"
  | "current_trick_by_left"
  | "current_trick_by_partner"
  | "current_trick_by_right"
  | "value_per_card"
  | "strength_per_card"
  | "lead_suit"
  | "trump_suit"
  | "mode"
  | "my_seat"
  | "starter_seat_relative"
  | "score_own_norm"
  | "score_opp_norm"
  | "trick_idx_norm"
  | "round_idx_norm";

export const SECTION_OFFSETS: Readonly<Record<SectionName, readonly [number, number]>> = {
  own_hand: [0, 36],
  played_by_me: [36, 72],
  played_by_left: [72, 108],
  played_by_partner: [108, 144],
  played_by_right: [144, 180],
  current_trick_by_me: [180, 216],
  current_trick_by_left: [216, 252],
  current_trick_by_partner: [252, 288],
  current_trick_by_right: [288, 324],
  value_per_card: [324, 360],
  strength_per_card: [360, 396],
  lead_suit: [396, 400],
  trump_suit: [400, 404],
  mode: [404, 409], // 5 Bits (+is_gumpf)
  my_seat: [409, 413],
  starter_seat_relative: [413, 417],
  score_own_norm: [417, 418],
  score_opp_norm: [418, 419],
  trick_idx_norm: [419, 420],
  round_idx_norm: [420, 421],
};

// --- Scoring-Konstanten ------------------------------------------------------

export const LAST_TRICK_BONUS = 5;
export const MATCH_BONUS = 100;
export const TOTAL_POINTS_PER_ROUND = 157; // 152 + 5 letzter Stich

/** Punktewerte, wenn die Variante TRUMPF/GUMPF gewählt ist und die Karte NICHT Trumpf ist. */
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

/** Punktewerte für die Trumpf-Farbe (Buur = 20, Nell = 14). Gilt für TRUMPF UND GUMPF. */
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
 * Gilt für TRUMPF und GUMPF gleich.
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

/** Maximalwerte für die Encoder-Normalisierung. */
export const VALUE_NORM_DIVISOR = 20; // Buur in TRUMPF/GUMPF — Maximum
export const STRENGTH_NORM_DIVISOR = 18; // Buur in Trumpf-Farbe: 10 + 8 = 18
