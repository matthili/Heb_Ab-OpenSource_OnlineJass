/**
 * Einfachster KI-Sitz: wählt eine zufällige legale Karte aus.
 *
 * Verwendung in M4: jeder KI-Sitz (aiSeatType="random") wird vom GameService
 * vor dem Move dieser Klasse übergeben. Mit M5 wird der `NNInferencePlayer`
 * dazu kommen, der dieselbe Schnittstelle implementiert — wir können dann
 * pro Sitz entscheiden, wer welchen Player-Typ bekommt.
 */
import { legalMoves, type Card, type GameState } from "@jass/engine";

export interface AIPlayer {
  /** Liefert eine **legale** Karte aus der Hand. */
  chooseCard(hand: readonly Card[], state: GameState): Card | Promise<Card>;
}

export class RandomLegalMovePlayer implements AIPlayer {
  chooseCard(hand: readonly Card[], state: GameState): Card {
    const legal = legalMoves(hand, state.current_trick_cards, state.variant);
    if (legal.length === 0) {
      throw new Error("RandomLegalMovePlayer: keine legalen Züge verfügbar");
    }
    const idx = Math.floor(Math.random() * legal.length);
    return legal[idx] as Card;
  }
}
