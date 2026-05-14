/**
 * State-Encoder + Legal-Action-Mask.
 *
 * Spiegelt `training/encoder.py` aus dem NN-Repo Byte-für-Byte:
 *   - 132-dim Float32-Vektor in der Reihenfolge aus `state_encoding.md`
 *   - 36-Bit-Uint8-Maske, in der ein 1-Bit eine legal spielbare Karte markiert
 *
 * Konsistenz wird durch `test/encoder.fixtures.test.ts` gegen
 * `external/jass-nn/encoding_fixtures.json` erzwungen.
 */

import { cardIndex } from "./cards.js";
import { legalMoves } from "./rules.js";
import {
  type Card,
  type GameState,
  ACTION_DIM,
  SECTION_OFFSETS,
  STATE_DIM,
  SUIT_ID,
} from "./types.js";

/**
 * Wandelt Spielzustand + eigene Hand in den 132-dim Feature-Vektor.
 *
 * Reihenfolge der Sections (aus `state_encoding.md` §"Aufbau des Featurevektors"):
 *
 *   0..35    own_hand           one-hot pro Karte in der Hand
 *  36..71    played_history     one-hot aller bisher gespielten (abgeschlossenen) Karten
 *  72..107   current_trick      one-hot der aktuell im Stich liegenden Karten
 * 108..111   lead_suit          one-hot über Lead-Farbe; alle 0 wenn Stich leer
 * 112..115   trump_suit         one-hot über Trumpf; nur bei mode=TRUMPF gesetzt
 * 116..119   mode               [is_trumpf, is_oben, is_unten, is_slalom_flag]
 * 120..123   my_seat            one-hot 0..3 (absolut)
 * 124..127   starter_seat       one-hot 0..3 (absolut)
 * 128        score_own_norm     min(own_team_score / 1000, 1.0)
 * 129        score_opp_norm     min(opp_team_score / 1000, 1.0)
 * 130        trick_idx_norm     trick_idx / 9.0
 * 131        round_idx_norm     min(round_idx / 20.0, 1.0)
 */
export function encodeState(hand: readonly Card[], state: GameState): Float32Array {
  const vec = new Float32Array(STATE_DIM);

  // own_hand
  {
    const off = SECTION_OFFSETS.own_hand[0];
    for (const c of hand) vec[off + cardIndex(c)] = 1;
  }

  // played_history (flatten aller abgeschlossenen Stiche)
  {
    const off = SECTION_OFFSETS.played_history[0];
    for (const trick of state.completed_tricks) {
      for (const c of trick) vec[off + cardIndex(c)] = 1;
    }
  }

  // current_trick
  {
    const off = SECTION_OFFSETS.current_trick[0];
    for (const c of state.current_trick_cards) vec[off + cardIndex(c)] = 1;
  }

  // lead_suit (nur wenn der aktuelle Stich überhaupt eine Karte hat)
  if (state.current_trick_cards.length > 0) {
    const lead = (state.current_trick_cards[0] as Card).suit;
    vec[SECTION_OFFSETS.lead_suit[0] + SUIT_ID[lead]] = 1;
  }

  // trump_suit (nur bei mode = TRUMPF)
  if (state.variant.mode === "TRUMPF" && state.variant.trump_suit !== undefined) {
    vec[SECTION_OFFSETS.trump_suit[0] + SUIT_ID[state.variant.trump_suit]] = 1;
  }

  // mode-Flags
  {
    const off = SECTION_OFFSETS.mode[0];
    if (state.variant.mode === "TRUMPF") vec[off + 0] = 1;
    else if (state.variant.mode === "OBEN") vec[off + 1] = 1;
    else vec[off + 2] = 1; // UNTEN
    if (state.announcement.slalom) vec[off + 3] = 1;
  }

  // Sitze (absolute Position 0..3)
  vec[SECTION_OFFSETS.my_seat[0] + state.player_idx] = 1;
  vec[SECTION_OFFSETS.starter_seat[0] + state.current_trick_starter] = 1;

  // Normalisierte Skalare. `Math.min(_, 1)` cap-t Werte > 1000 Punkte.
  vec[SECTION_OFFSETS.score_own_norm[0]] = Math.min(state.own_team_score / 1000, 1);
  vec[SECTION_OFFSETS.score_opp_norm[0]] = Math.min(state.opp_team_score / 1000, 1);
  vec[SECTION_OFFSETS.trick_idx_norm[0]] = state.trick_idx / 9;
  vec[SECTION_OFFSETS.round_idx_norm[0]] = Math.min(state.round_idx / 20, 1);

  return vec;
}

/**
 * Aktions-Maske: 36 Bytes, 1 bedeutet "Karte spielbar".
 *
 * Wird sowohl im Modell-Input (Logits-Bias `(1 - mask) * -1e9`) als auch in
 * der Server-Validierung benutzt — der Game-Service nimmt für jeden Move-Versuch
 * `mask[cardIndex(move)] === 1` als notwendige Bedingung.
 */
export function legalActionMask(hand: readonly Card[], state: GameState): Uint8Array {
  const mask = new Uint8Array(ACTION_DIM);
  for (const c of legalMoves(hand, state.current_trick_cards, state.variant)) {
    mask[cardIndex(c)] = 1;
  }
  return mask;
}
