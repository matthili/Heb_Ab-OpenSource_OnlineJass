/**
 * Karten-Helfer: Index ↔ Card, Equality, Weli-Check.
 *
 * Index-Formel `suit * 9 + rank` ist der **einzige** kanonische Karten-Index
 * der Plattform — sowohl in der Aktions-Maske (36 Bits) als auch in den
 * One-Hot-Sektionen des 132-dim State-Encoders.
 */

import {
  type Card,
  type CardIndex,
  type Suit,
  DECK_SIZE,
  RANKS,
  RANK_ID,
  SUITS,
  SUIT_ID,
  WELI,
} from "./types.js";

/** Gibt den eindeutigen Index 0..35 einer Karte zurück. */
export function cardIndex(card: Card): CardIndex {
  return SUIT_ID[card.suit] * 9 + RANK_ID[card.rank];
}

/** Umkehrung von `cardIndex`. Wirft bei Indizes außerhalb 0..35. */
export function indexToCard(idx: CardIndex): Card {
  if (!Number.isInteger(idx) || idx < 0 || idx >= DECK_SIZE) {
    throw new RangeError(`cardIndex außerhalb 0..${DECK_SIZE - 1}: ${idx}`);
  }
  const suitId = Math.floor(idx / 9);
  const rankId = idx % 9;
  // SUITS/RANKS sind 4 bzw. 9 Elemente lang und Index-validiert; die
  // `noUncheckedIndexedAccess` Strict-Option fordert hier dennoch ein Cast.
  return {
    suit: SUITS[suitId] as Suit,
    rank: RANKS[rankId] as Card["rank"],
  };
}

/** Strukturelle Gleichheit zweier Karten (suit + rank). */
export function cardsEqual(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/**
 * Ist die Karte der Weli (Schelle-Sechs)?
 *
 * Im laufenden Spiel zählt der Weli wie jede andere Schelle-Sechs (0 Punkte,
 * keine Sonderstärke); er beeinflusst nur die Trumpf-Ansage in Runde 1.
 * Trotzdem ist es bequem, einen Helper zu haben — etwa für die UI, die das
 * Sonderbild `schelle-6-weli.png` rendern soll.
 */
export function isWeli(card: Card): boolean {
  return cardsEqual(card, WELI);
}
