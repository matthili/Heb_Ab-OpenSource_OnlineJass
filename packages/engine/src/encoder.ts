/**
 * State-Encoder + Legal-Action-Mask.
 *
 * Encoding-Version: **3.0.0** (Release v0.5.0 des NN-Repos).
 *
 * Spiegelt `training/encoder.py` Byte-für-Byte; Konsistenz wird durch
 * `test/encoder.fixtures.test.ts` gegen `external/jass-nn/encoding_fixtures.json`
 * erzwungen (15 Fixtures, atol 1e-5).
 *
 * Vektor-Layout (siehe state_encoding.md §"Aufbau des 421-dim Featurevektors"):
 *
 *     0..35     own_hand                  one-hot in der eigenen Hand
 *    36..71     played_by_me              History (abgeschlossene Stiche) per Sitz
 *    72..107    played_by_left            (rel=1, links neben mir)
 *   108..143    played_by_partner         (rel=2, gegenüber)
 *   144..179    played_by_right           (rel=3, rechts neben mir)
 *   180..215    current_trick_by_me       laufender Stich, gleiche Sitz-Logik
 *   216..251    current_trick_by_left
 *   252..287    current_trick_by_partner
 *   288..323    current_trick_by_right
 *   324..359    value_per_card            card_value(c, variant) / 20.0  (NEU v3)
 *   360..395    strength_per_card         strength(c, variant, lead) / 18.0  (NEU v3)
 *   396..399    lead_suit                 one-hot; alle 0 wenn Stich leer
 *   400..403    trump_suit                one-hot; gesetzt bei TRUMPF UND GUMPF
 *   404..408    mode                      [is_trumpf, is_gumpf, is_oben, is_unten, is_slalom]
 *   409..412    my_seat                   one-hot absoluter Sitz 0..3
 *   413..416    starter_seat_relative     one-hot RELATIV: (starter - my_seat) mod 4
 *   417        score_own_norm            min(own / 1000, 1.0)
 *   418        score_opp_norm            min(opp / 1000, 1.0)
 *   419        trick_idx_norm            trick_idx / 9.0
 *   420        round_idx_norm            min(round / 20.0, 1.0)
 */

import { cardIndex } from "./cards.js";
import { cardValue, hasTrumpSuit, legalMoves } from "./rules.js";
import {
  type Card,
  type GameState,
  type Rank,
  type Suit,
  type Variant,
  ACTION_DIM,
  NUM_PLAYERS,
  RANK_ID,
  RANKS,
  SECTION_OFFSETS,
  STATE_DIM,
  STRENGTH_NORM_DIVISOR,
  SUITS,
  SUIT_ID,
  TRUMP_RANK_ORDER,
  VALUE_NORM_DIVISOR,
} from "./types.js";

/**
 * Relative Sitz-Position eines anderen Spielers, vom eigenen Sitz aus
 * im Uhrzeigersinn gezählt:
 *   0 = ich selbst, 1 = links, 2 = gegenüber/Partner, 3 = rechts.
 */
function relativeSeat(otherSeat: number, mySeat: number): number {
  return (((otherSeat - mySeat) % NUM_PLAYERS) + NUM_PLAYERS) % NUM_PLAYERS;
}

const PLAYED_OFFSETS: readonly number[] = [
  SECTION_OFFSETS.played_by_me[0],
  SECTION_OFFSETS.played_by_left[0],
  SECTION_OFFSETS.played_by_partner[0],
  SECTION_OFFSETS.played_by_right[0],
];

const CURRENT_TRICK_OFFSETS: readonly number[] = [
  SECTION_OFFSETS.current_trick_by_me[0],
  SECTION_OFFSETS.current_trick_by_left[0],
  SECTION_OFFSETS.current_trick_by_partner[0],
  SECTION_OFFSETS.current_trick_by_right[0],
];

/**
 * Wertpunkt einer Karte für die value_per_card-Section (Wert/20).
 * Spiegelt `rules.cardValue` 1:1; separat als kleiner Helper für den Encoder.
 */
function cardValueNormalized(card: Card, variant: Variant): number {
  return cardValue(card, variant) / VALUE_NORM_DIVISOR;
}

/**
 * Kraftpunkt einer Karte (1..18) für die strength_per_card-Section, /18.
 *
 * - TRUMPF/GUMPF + Trumpf-Farbe: `10 + TRUMP_RANK_ORDER[rank]`
 *   (Buur=18, Nell=17, A=16, K=15, O=14, 10=13, 8=12, 7=11, 6=10)
 * - TRUMPF + Nicht-Trumpf:       `1 + rank_id`     (6=1 … A=9, aufsteigend)
 * - GUMPF  + Nicht-Trumpf:       `1 + (8 - rank)`  (6=9 … A=1, invertiert)
 * - OBEN   + Karte: in Lead-Suit `10 + rank_id`,    sonst `1 + rank_id`
 * - UNTEN  + Karte: in Lead-Suit `10 + (8-rank)`,   sonst `1 + (8-rank)`
 *
 * Sonderfall OBEN/UNTEN bei leerem Stich (`leadSuit === null`):
 *   Die eigene Suit der Karte wird als hypothetischer Lead behandelt → jede
 *   Karte bekommt den 10..18-Boost ("Anspiel-Kraft"). Bei TRUMPF/GUMPF gibt es
 *   diesen Boost-Effekt nicht (für Nicht-Trumpf ist die Stärke unabhängig vom
 *   Lead-Status).
 */
function cardStrengthRaw(card: Card, variant: Variant, leadSuit: Suit | null): number {
  const rankId = RANK_ID[card.rank];
  const mode = variant.mode;

  if (mode === "TRUMPF" || mode === "GUMPF") {
    if (card.suit === variant.trump_suit) {
      return 10 + TRUMP_RANK_ORDER[card.rank];
    }
    // Nicht-Trumpf: unabhängig vom Lead-Status (state_encoding.md §3.0).
    return mode === "GUMPF" ? 1 + (8 - rankId) : 1 + rankId;
  }

  // OBEN / UNTEN
  const invert = mode === "UNTEN";
  const rankComponent = invert ? 8 - rankId : rankId;

  // Bei leerem Stich (Anspiel) bekommt jede Karte den Lead-Boost auf ihrer
  // eigenen Suit.
  const isLeadOrEmpty = leadSuit === null || card.suit === leadSuit;
  const base = isLeadOrEmpty ? 10 : 1;
  return base + rankComponent;
}

function cardStrengthNormalized(card: Card, variant: Variant, leadSuit: Suit | null): number {
  return cardStrengthRaw(card, variant, leadSuit) / STRENGTH_NORM_DIVISOR;
}

/**
 * Wandelt Spielzustand + eigene Hand in den 421-dim Feature-Vektor.
 * Output ist Float32Array; alle Werte in `[0.0, 1.0]`.
 */
export function encodeState(hand: readonly Card[], state: GameState): Float32Array {
  const vec = new Float32Array(STATE_DIM);
  const mySeat = state.player_idx;

  // 1) own_hand
  {
    const off = SECTION_OFFSETS.own_hand[0];
    for (const c of hand) vec[off + cardIndex(c)] = 1;
  }

  // 2) played_by_{me,left,partner,right} aus completed_tricks
  for (const trick of state.completed_tricks) {
    for (let k = 0; k < trick.cards.length; k++) {
      const card = trick.cards[k] as Card;
      const absSeat = (trick.starter + k) % NUM_PLAYERS;
      const rel = relativeSeat(absSeat, mySeat);
      const sectionOff = PLAYED_OFFSETS[rel] as number;
      vec[sectionOff + cardIndex(card)] = 1;
    }
  }

  // 3) current_trick_by_{me,left,partner,right} aus current_trick_cards
  for (let k = 0; k < state.current_trick_cards.length; k++) {
    const card = state.current_trick_cards[k] as Card;
    const absSeat = (state.current_trick_starter + k) % NUM_PLAYERS;
    const rel = relativeSeat(absSeat, mySeat);
    const sectionOff = CURRENT_TRICK_OFFSETS[rel] as number;
    vec[sectionOff + cardIndex(card)] = 1;
  }

  // 4) value_per_card — 36 Floats
  {
    const off = SECTION_OFFSETS.value_per_card[0];
    for (let suitIdx = 0; suitIdx < SUITS.length; suitIdx++) {
      const suit = SUITS[suitIdx] as Suit;
      for (let rankIdx = 0; rankIdx < RANKS.length; rankIdx++) {
        const rank = RANKS[rankIdx] as Rank;
        const idx = suitIdx * 9 + rankIdx;
        vec[off + idx] = cardValueNormalized({ suit, rank }, state.variant);
      }
    }
  }

  // 5) strength_per_card — 36 Floats; Lead-Suit ist null bei leerem Stich
  {
    const off = SECTION_OFFSETS.strength_per_card[0];
    const leadSuit: Suit | null =
      state.current_trick_cards.length > 0 ? (state.current_trick_cards[0] as Card).suit : null;
    for (let suitIdx = 0; suitIdx < SUITS.length; suitIdx++) {
      const suit = SUITS[suitIdx] as Suit;
      for (let rankIdx = 0; rankIdx < RANKS.length; rankIdx++) {
        const rank = RANKS[rankIdx] as Rank;
        const idx = suitIdx * 9 + rankIdx;
        vec[off + idx] = cardStrengthNormalized({ suit, rank }, state.variant, leadSuit);
      }
    }
  }

  // 6) lead_suit (nur wenn aktueller Stich Karten enthält)
  if (state.current_trick_cards.length > 0) {
    const lead = (state.current_trick_cards[0] as Card).suit;
    vec[SECTION_OFFSETS.lead_suit[0] + SUIT_ID[lead]] = 1;
  }

  // 7) trump_suit — gesetzt bei TRUMPF UND GUMPF
  if (hasTrumpSuit(state.variant) && state.variant.trump_suit !== undefined) {
    vec[SECTION_OFFSETS.trump_suit[0] + SUIT_ID[state.variant.trump_suit]] = 1;
  }

  // 8) mode — 5 Bits: [is_trumpf, is_gumpf, is_oben, is_unten, is_slalom_flag]
  {
    const off = SECTION_OFFSETS.mode[0];
    switch (state.variant.mode) {
      case "TRUMPF":
        vec[off + 0] = 1;
        break;
      case "GUMPF":
        vec[off + 1] = 1;
        break;
      case "OBEN":
        vec[off + 2] = 1;
        break;
      case "UNTEN":
        vec[off + 3] = 1;
        break;
    }
    if (state.announcement.slalom) vec[off + 4] = 1;
  }

  // 9) my_seat (absolut)
  vec[SECTION_OFFSETS.my_seat[0] + mySeat] = 1;

  // 10) starter_seat_relative — Anspieler des aktuellen Stichs RELATIV
  {
    const rel = relativeSeat(state.current_trick_starter, mySeat);
    vec[SECTION_OFFSETS.starter_seat_relative[0] + rel] = 1;
  }

  // 11) Normalisierte Skalare
  vec[SECTION_OFFSETS.score_own_norm[0]] = Math.min(state.own_team_score / 1000, 1);
  vec[SECTION_OFFSETS.score_opp_norm[0]] = Math.min(state.opp_team_score / 1000, 1);
  vec[SECTION_OFFSETS.trick_idx_norm[0]] = state.trick_idx / 9;
  vec[SECTION_OFFSETS.round_idx_norm[0]] = Math.min(state.round_idx / 20, 1);

  return vec;
}

/**
 * Aktions-Maske: 36 Bytes, 1 bedeutet "Karte spielbar".
 */
export function legalActionMask(hand: readonly Card[], state: GameState): Uint8Array {
  const mask = new Uint8Array(ACTION_DIM);
  for (const c of legalMoves(hand, state.current_trick_cards, state.variant)) {
    mask[cardIndex(c)] = 1;
  }
  return mask;
}

// --- Re-Export der Encoder-Helper für Unit-Tests ----------------------------
export {
  cardStrengthRaw as _cardStrengthRaw,
  cardValueNormalized as _cardValueNormalized,
  cardStrengthNormalized as _cardStrengthNormalized,
  relativeSeat as _relativeSeat,
};
