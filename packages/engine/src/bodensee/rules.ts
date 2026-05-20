/**
 * **Bodensee-Jass — Regeln.**
 *
 * Die Stich-Regeln (Farbzwang, Buur-Ausnahme) sind identisch zu Kreuz/Solo.
 * Einziger struktureller Unterschied: der „Karten-Pool" für den Bedienzwang
 * ist nicht die 9-Karten-Hand, sondern **Hand + sichtbare Tisch-Karten**.
 * Verdeckte Tisch-Karten zählen weder für den Bedienzwang noch sind sie
 * spielbar.
 *
 * Die „kein-Untertrumpfen"-Regel ist im 2-Spieler-Bodensee strukturell
 * irrelevant (ein Stich hat genau 2 Karten — Anspiel + Antwort, kein
 * dritter Spieler). Daher kann `legalMoves` aus `../rules.js` 1:1
 * weiterverwendet werden, mit dem vollen Pool als „Hand".
 *
 * TS-Port von `jass_engine/bodensee/rules.py`.
 */
import { legalMoves } from "../rules.js";
import { cardsEqual } from "../cards.js";
import type { Card, Variant } from "../types.js";
import type { TableStack } from "./types.js";

/** Sichtbare Tisch-Karten in Stapel-Reihenfolge (ohne leere Stapel). */
export function visibleTableCards(table: readonly TableStack[]): Card[] {
  const out: Card[] = [];
  for (const s of table) {
    if (s.visible !== null) out.push(s.visible);
  }
  return out;
}

/** Anzahl noch verdeckter Karten auf einem Tisch. */
export function hiddenTableCount(table: readonly TableStack[]): number {
  let n = 0;
  for (const s of table) {
    if (s.hidden !== null) n++;
  }
  return n;
}

/**
 * Karten, die der Spieler legal ausspielen darf. Pool = Hand + sichtbare
 * Tisch-Karten; danach greift der reguläre Bedienzwang aus `legalMoves`.
 */
export function legalMovesBodensee(
  hand: readonly Card[],
  table: readonly TableStack[],
  currentTrick: readonly Card[],
  variant: Variant
): Card[] {
  const pool = [...hand, ...visibleTableCards(table)];
  return legalMoves(pool, currentTrick, variant);
}

/**
 * Liefert `"hand"` oder `"table"`, je nachdem wo die Karte liegt.
 * Wirft, wenn die Karte weder in der Hand noch sichtbar auf dem Tisch ist.
 */
export function cardSource(
  hand: readonly Card[],
  table: readonly TableStack[],
  card: Card
): "hand" | "table" {
  if (hand.some((c) => cardsEqual(c, card))) return "hand";
  if (table.some((s) => s.visible !== null && cardsEqual(s.visible, card))) {
    return "table";
  }
  throw new Error(
    `Bodensee: Karte ${card.suit}-${card.rank} liegt weder in der Hand noch sichtbar auf dem Tisch.`
  );
}
