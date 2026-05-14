/**
 * Reine Regel-Funktionen: Punktewerte, Stich-Stärke, legale Züge,
 * Stich-Gewinner, Stich-Punkte. Spiegelt `jass_engine/rules.py` aus dem NN-Repo.
 *
 * Keine State-Mutation, keine Klassen — alles pure functions, damit Encoder
 * und Spielzustand-Logik (state.ts) sie composable wiederverwenden können.
 */

import { cardsEqual } from "./cards.js";
import {
  type Card,
  type PlayMode,
  type Rank,
  type Suit,
  type Variant,
  POINT_VALUES_NORMAL,
  POINT_VALUES_OBEN_UNTEN,
  POINT_VALUES_TRUMP,
  RANK_ID,
  TRUMP_RANK_ORDER,
  LAST_TRICK_BONUS,
} from "./types.js";

/** Punktwert einer Karte unter Berücksichtigung der gewählten Variante. */
export function cardValue(card: Card, variant: Variant): number {
  if (variant.mode === "TRUMPF") {
    if (card.suit === variant.trump_suit) {
      return POINT_VALUES_TRUMP[card.rank];
    }
    return POINT_VALUES_NORMAL[card.rank];
  }
  // OBEN oder UNTEN — gleiche Tabelle, 8er = 8
  return POINT_VALUES_OBEN_UNTEN[card.rank];
}

/**
 * Stärke einer Karte im aktuellen Stich. Höher = sticht.
 *
 * Drei Skalen:
 *  - Nicht-stechende Karte (falsche Farbe, kein Trumpf): -1
 *  - Lead-Farbe (nicht-Trumpf):                          100 + rank-id  (TRUMPF/OBEN)
 *                                                       100 + (8-rank)  (UNTEN, invertiert)
 *  - Trumpf:                                            1000 + TRUMP_RANK_ORDER
 */
export function cardStrength(card: Card, leadSuit: Suit, variant: Variant): number {
  const mode: PlayMode = variant.mode;
  if (mode === "TRUMPF") {
    if (variant.trump_suit === undefined) {
      throw new Error("Variant.TRUMPF benötigt eine trump_suit.");
    }
    if (card.suit === variant.trump_suit) return 1000 + TRUMP_RANK_ORDER[card.rank];
    if (card.suit === leadSuit) return 100 + RANK_ID[card.rank];
    return -1;
  }
  if (mode === "OBEN") {
    if (card.suit === leadSuit) return 100 + RANK_ID[card.rank];
    return -1;
  }
  // UNTEN: invertierte Rangstärke — 6 (rank=0) wird zu 8, Ass (rank=8) wird zu 0
  if (card.suit === leadSuit) return 100 + (8 - RANK_ID[card.rank]);
  return -1;
}

function highestTrumpIn(cards: readonly Card[], trump: Suit): Card | null {
  let best: Card | null = null;
  let bestOrder = -1;
  for (const c of cards) {
    if (c.suit !== trump) continue;
    const o = TRUMP_RANK_ORDER[c.rank];
    if (o > bestOrder) {
      bestOrder = o;
      best = c;
    }
  }
  return best;
}

/**
 * Liste der Karten, die der Spieler legal ausspielen darf.
 *
 * **TRUMPF**:
 *   - Bei leerem Stich: alles erlaubt.
 *   - Trumpf wurde angespielt:
 *       * Hat man Nicht-Buur-Trümpfe → muss man bedienen (alle Trümpfe der Hand).
 *       * Hat man nur den Buur als Trumpf → man darf den Buur "verstecken" und
 *         eine andere Karte spielen ⇒ alle Karten erlaubt.
 *       * Hat man gar keine Trümpfe → alles erlaubt.
 *   - Nicht-Trumpf wurde angespielt:
 *       * Hat man die Lead-Farbe → bedienen; der Buur darf zusätzlich gespielt
 *         werden (Buur-Ausnahme), wenn er nicht in der Lead-Farbe steckt.
 *       * Sonst → kein-Untertrumpfen: man darf nur höhere Trümpfe oder
 *         Nicht-Trümpfe spielen; ist das leer, ist Untertrumpfen erzwungen
 *         und alles erlaubt.
 *
 * **OBEN/UNTEN (Bock/Geiss/Slalom)**:
 *   - Einfacher Farbzwang; wer Lead-Farbe nicht bedienen kann, wirft frei ab.
 *
 * Reihenfolge der Rückgabe spielt für die Legal-Mask keine Rolle, ist aber
 * stabil definiert für Test-Vergleichbarkeit (deterministisch in Hand-Reihenfolge).
 */
export function legalMoves(
  hand: readonly Card[],
  currentTrick: readonly Card[],
  variant: Variant
): Card[] {
  if (currentTrick.length === 0) return [...hand];

  // Index 0 ist garantiert vorhanden (Länge > 0 oben geprüft); der Cast ist
  // wegen `noUncheckedIndexedAccess` nötig.
  const leadSuit = (currentTrick[0] as Card).suit;

  if (variant.mode !== "TRUMPF") {
    const same = hand.filter((c) => c.suit === leadSuit);
    return same.length > 0 ? same : [...hand];
  }

  if (variant.trump_suit === undefined) {
    throw new Error("Variant.TRUMPF benötigt eine trump_suit.");
  }
  const trump: Suit = variant.trump_suit;
  const buur: Card = { suit: trump, rank: "UNTER" as Rank };
  const hasBuur = hand.some((c) => cardsEqual(c, buur));

  // Fall A: Trumpf wurde angespielt
  if (leadSuit === trump) {
    const trumpsInHand = hand.filter((c) => c.suit === trump);
    const nonBuurTrumps = trumpsInHand.filter((c) => c.rank !== "UNTER");
    if (nonBuurTrumps.length > 0) return trumpsInHand;
    // Entweder nur Buur, oder gar keine Trümpfe → frei wählbar.
    return [...hand];
  }

  // Fall B: Nicht-Trumpf wurde angespielt; man hat die Lead-Farbe
  const same = hand.filter((c) => c.suit === leadSuit);
  if (same.length > 0) {
    if (hasBuur && !same.some((c) => cardsEqual(c, buur))) {
      return [...same, buur];
    }
    return same;
  }

  // Fall C: Nicht-Trumpf angespielt, Lead-Farbe nicht in der Hand
  const highest = highestTrumpIn(currentTrick, trump);
  if (highest === null) {
    // Bisher liegt kein Trumpf im Stich → alles abwerfbar
    return [...hand];
  }
  const highestOrder = TRUMP_RANK_ORDER[highest.rank];
  const higherTrumps = hand.filter(
    (c) => c.suit === trump && TRUMP_RANK_ORDER[c.rank] > highestOrder
  );
  const nonTrumps = hand.filter((c) => c.suit !== trump);
  const legal = [...higherTrumps, ...nonTrumps];
  if (legal.length > 0) return legal;
  // Nur tiefere Trümpfe vorhanden → Untertrumpfen ist erzwungen.
  return [...hand];
}

/** Index (0..n-1) des Gewinners im übergebenen Stich. Wirft bei leerem Stich. */
export function trickWinner(trick: readonly Card[], variant: Variant): number {
  if (trick.length === 0) {
    throw new Error("Leerer Stich hat keinen Gewinner.");
  }
  const leadSuit = (trick[0] as Card).suit;
  let bestIdx = 0;
  let bestStrength = cardStrength(trick[0] as Card, leadSuit, variant);
  for (let i = 1; i < trick.length; i++) {
    const s = cardStrength(trick[i] as Card, leadSuit, variant);
    if (s > bestStrength) {
      bestStrength = s;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Summe der Kartenwerte im Stich plus +5 für den letzten Stich. */
export function trickPoints(trick: readonly Card[], variant: Variant, isLastTrick = false): number {
  let pts = 0;
  for (const c of trick) pts += cardValue(c, variant);
  if (isLastTrick) pts += LAST_TRICK_BONUS;
  return pts;
}
