/**
 * **Bodensee-Jass — State-Encoder (`bodensee_1.0.0`, 291 Dimensionen).**
 *
 * TS-Port von `training/bodensee_encoder.py`. Maßgebliche Referenz:
 * `external/jass-nn/bodensee/bodensee_state_encoding.md`.
 *
 * Anders als der v3.0.0-Encoder (Kreuz/Solo, 421 dim): 2 Spieler statt 4,
 * eigene Sektionen für die Tisch-Mechanik, eine konsolidierte
 * `opp_lead_card`-Sektion statt 4 Trick-Slots.
 *
 * `value_per_card` + `strength_per_card` nutzen identische Logik wie v3 —
 * wir importieren die Helper direkt aus `../encoder.js`.
 *
 * Verifikation: byte-genau gegen `bodensee_encoding_fixtures.json`.
 */
import { cardIndex } from "../cards.js";
import { _cardStrengthNormalized, _cardValueNormalized } from "../encoder.js";
import { legalMoves } from "../rules.js";
import { RANKS, SUIT_ID, SUITS, type Card, type Suit } from "../types.js";
import type { BodenseeEncoderInput } from "./types.js";

/** Featurevektor-Dimension. */
export const BODENSEE_STATE_DIM = 291;
/** Aktionsraum (36 Karten). */
export const BODENSEE_ACTION_DIM = 36;
/** Encoding-Version aus dem MANIFEST. */
export const BODENSEE_ENCODING_VERSION = "bodensee_1.0.0";

// Section-Offsets — exakt nach bodensee_state_encoding.md.
const OFF = {
  own_hand: 0,
  own_visible_table: 36,
  own_hidden_table_mask: 72,
  opp_visible_table: 78,
  opp_hand_count: 114,
  opp_hidden_table_count: 121,
  played_cards_this_round: 128,
  opp_lead_card: 164,
  i_am_leading: 200,
  value_per_card: 201,
  strength_per_card: 237,
  lead_suit: 273,
  trump_suit: 277,
  mode: 281,
  i_am_announcer: 286,
  score_own_norm: 287,
  score_opp_norm: 288,
  trick_idx_norm: 289,
  round_idx_norm: 290,
} as const;

const MAX_HAND_SIZE = 6;
const MAX_HIDDEN_COUNT = 6;

/** Setzt die One-Hot-Bits einer Karten-Liste in einer Sektion. */
function setCardBits(vec: Float32Array, offset: number, cards: readonly Card[]): void {
  for (const c of cards) {
    vec[offset + cardIndex(c)] = 1;
  }
}

/**
 * Encodiert einen Bodensee-Spielzustand zum 291-dim Featurevektor.
 * Eingabe entspricht 1:1 dem `input`-Objekt der Encoding-Fixtures.
 */
export function encodeBodenseeState(input: BodenseeEncoderInput): Float32Array {
  const vec = new Float32Array(BODENSEE_STATE_DIM);
  const variant = input.variant_effective;

  // 1) Eigene Hand.
  setCardBits(vec, OFF.own_hand, input.hand);

  // 2) Eigene sichtbare Tisch-Karten.
  const ownVisible: Card[] = [];
  for (const s of input.own_table) {
    if (s.visible !== null) ownVisible.push(s.visible);
  }
  setCardBits(vec, OFF.own_visible_table, ownVisible);

  // 3) Eigene Hidden-Stapel-Maske — ein Bit pro Stapel-Position.
  input.own_table.forEach((s, i) => {
    if (s.has_hidden) vec[OFF.own_hidden_table_mask + i] = 1;
  });

  // 4) Gegner sichtbare Tisch-Karten.
  setCardBits(vec, OFF.opp_visible_table, input.opponent_visible_table);

  // 5) Gegner Hand-Count (One-Hot, gekappt bei 6).
  vec[OFF.opp_hand_count + Math.min(input.opponent_hand_count, MAX_HAND_SIZE)] = 1;

  // 6) Gegner Hidden-Count (One-Hot, gekappt bei 6).
  vec[OFF.opp_hidden_table_count + Math.min(input.opponent_hidden_table_count, MAX_HIDDEN_COUNT)] =
    1;

  // 7) Bereits gespielte Karten dieser Runde (alle Stiche + laufender).
  const played: Card[] = [];
  for (const ct of input.completed_tricks) played.push(...ct.cards);
  played.push(...input.current_trick_cards);
  setCardBits(vec, OFF.played_cards_this_round, played);

  // 8) Lead-Karte des Gegners (nur wenn ich nicht selbst leite).
  const iAmLeading = input.current_trick_starter === input.player_idx;
  if (!iAmLeading && input.current_trick_cards.length > 0) {
    setCardBits(vec, OFF.opp_lead_card, [input.current_trick_cards[0] as Card]);
  }

  // 9) i_am_leading-Bit.
  if (iAmLeading) vec[OFF.i_am_leading] = 1;

  // 10) value_per_card + strength_per_card — für alle 36 Karten.
  const leadSuit: Suit | null =
    input.current_trick_cards.length > 0 ? (input.current_trick_cards[0] as Card).suit : null;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const c: Card = { suit, rank };
      const idx = cardIndex(c);
      vec[OFF.value_per_card + idx] = _cardValueNormalized(c, variant);
      vec[OFF.strength_per_card + idx] = _cardStrengthNormalized(c, variant, leadSuit);
    }
  }

  // 11) Lead-Suit One-Hot.
  if (leadSuit !== null) vec[OFF.lead_suit + SUIT_ID[leadSuit]] = 1;

  // 12) Trump-Suit One-Hot (bei TRUMPF + GUMPF).
  if ((variant.mode === "TRUMPF" || variant.mode === "GUMPF") && variant.trump_suit !== undefined) {
    vec[OFF.trump_suit + SUIT_ID[variant.trump_suit]] = 1;
  }

  // 13) Mode-Flags [is_trumpf, is_gumpf, is_oben, is_unten, is_slalom].
  if (variant.mode === "TRUMPF") vec[OFF.mode + 0] = 1;
  else if (variant.mode === "GUMPF") vec[OFF.mode + 1] = 1;
  else if (variant.mode === "OBEN") vec[OFF.mode + 2] = 1;
  else vec[OFF.mode + 3] = 1; // UNTEN
  if (input.announcement.slalom) vec[OFF.mode + 4] = 1;

  // 14) i_am_announcer.
  if (input.i_am_announcer) vec[OFF.i_am_announcer] = 1;

  // 15) Score normalisiert (gekappt bei 1.0 für 1000).
  vec[OFF.score_own_norm] = Math.min(input.own_score / 1000, 1);
  vec[OFF.score_opp_norm] = Math.min(input.opp_score / 1000, 1);

  // 16) Stich-/Runden-Index normalisiert.
  vec[OFF.trick_idx_norm] = input.trick_idx / 18;
  vec[OFF.round_idx_norm] = Math.min(input.round_idx / 20, 1);

  return vec;
}

/**
 * 36-Bit Aktionsmaske: `1` für legal spielbare Karten (Hand + sichtbarer
 * Tisch zusammen unter Bedienzwang). Importiert `legalMovesBodensee` —
 * der Encoder-Test prüft diese Maske ebenfalls gegen die Fixtures.
 */
export function legalActionMaskBodensee(input: BodenseeEncoderInput): Uint8Array {
  const mask = new Uint8Array(BODENSEE_ACTION_DIM);
  // Pool = Hand + sichtbare Tisch-Karten; danach greift der reguläre
  // Bedienzwang aus `legalMoves` (gleiche Logik wie Kreuz/Solo).
  const pool: Card[] = [...input.hand];
  for (const s of input.own_table) {
    if (s.visible !== null) pool.push(s.visible);
  }
  for (const c of legalMoves(pool, input.current_trick_cards, input.variant_effective)) {
    mask[cardIndex(c)] = 1;
  }
  return mask;
}
