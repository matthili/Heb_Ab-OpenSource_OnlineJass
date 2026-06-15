/**
 * Void-Inferenz aus der Spielhistorie — welche Karten kann ein Sitz beweisbar
 * NICHT halten. TS-Port von `jass_engine/void_inference.py` (Schwester-Repo
 * JCN9000).
 *
 * Grundlage ist die Bedien-Regel (`legalMoves`):
 *
 *   - **Trumpf angespielt**, Nicht-Trumpf gespielt → der Sitz hatte keinen
 *     Nicht-Buur-Trumpf (sonst Trumpf-Zwang). Den Buur darf er behalten
 *     (Buur-Ausnahme). → blank in allen Trümpfen AUSSER dem Buur.
 *   - **Nicht-Trumpf-Lead** (oder Variante ohne Trumpf): Karte gespielt, die
 *     WEDER die Lead-Farbe NOCH Trumpf ist → blank in der Lead-Farbe. (Ein
 *     Trumpf auf einen Nicht-Trumpf-Lead ist Stechen — auch mit Lead-Farbe auf
 *     der Hand erlaubt → kein Schluss.)
 *
 * Ergebnis: pro Sitz eine Menge **verbotener Karten** (Soundness: wir schließen
 * nur aus, was beweisbar unmöglich ist).
 *
 * **Vereinfachung ggü. dem Original:** Statt der Per-Stich-Variante genügt EIN
 * `trump`-Argument, denn die Trumpf-Farbe ist über eine ganze Runde konstant —
 * TRUMPF/GUMPF → die Trumpf-Farbe, OBEN/UNTEN/SLALOM → `null` (Slalom alterniert
 * nur Oben/Unten, beide ohne Trumpf). Der Konsument (Heuristik-Trumpf-Disziplin)
 * ruft die Inferenz ohnehin nur im TRUMPF/GUMPF-Fall auf.
 */
import type { CompletedTrick, Suit } from "./types.js";
import { RANKS } from "./types.js";

/** Stabiler Mengen-Schlüssel einer Karte. */
function cardKey(suit: Suit, rank: string): string {
  return `${suit}-${rank}`;
}

/**
 * Leitet pro Sitz die Menge der Karten ab (als `"suit-rank"`-Keys), die der
 * Sitz beweisbar NICHT halten kann.
 *
 * @param completedTricks Abgeschlossene Stiche der laufenden Runde, in Reihenfolge.
 * @param trump Trumpf-Farbe der Runde, oder `null` bei Oben/Unten/Slalom.
 * @param numPlayers Spielerzahl (4 bei Kreuz/Solo, 2 bei Bodensee).
 */
export function inferForbiddenCards(
  completedTricks: readonly CompletedTrick[],
  trump: Suit | null,
  numPlayers: number
): Map<number, Set<string>> {
  const forbidden = new Map<number, Set<string>>();
  for (let s = 0; s < numPlayers; s++) forbidden.set(s, new Set<string>());

  for (const trick of completedTricks) {
    const cards = trick.cards;
    if (cards.length < 2) continue;
    const ledSuit = cards[0]!.suit;

    for (let j = 1; j < cards.length; j++) {
      const seat = (trick.starter + j) % numPlayers;
      const played = cards[j]!;
      const set = forbidden.get(seat)!;

      if (trump !== null && ledSuit === trump) {
        // Trumpf angespielt, Nicht-Trumpf gespielt → blank in Trumpf außer Buur.
        if (played.suit !== trump) {
          for (const r of RANKS) {
            if (r !== "UNTER") set.add(cardKey(trump, r));
          }
        }
        // Trumpf gefolgt → kein Schluss.
      } else {
        // Nicht-Trumpf-Lead: Karte weder Lead-Farbe noch Trumpf → blank in Lead.
        const isTrumpCard = trump !== null && played.suit === trump;
        if (played.suit !== ledSuit && !isTrumpCard) {
          for (const r of RANKS) set.add(cardKey(ledSuit, r));
        }
      }
    }
  }

  return forbidden;
}

/**
 * True, wenn der Sitz beweisbar keinen Trumpf außer evtl. dem Buur (Trumpf-Unter)
 * hat. Der Buur wird bewusst ignoriert (Buur-Ausnahme) — ein einzelner Buur beim
 * Gegner ändert an der „ausgetrumpft"-Lage nichts Wesentliches.
 */
export function seatIsVoidInTrump(forbiddenForSeat: Set<string>, trump: Suit): boolean {
  for (const r of RANKS) {
    if (r === "UNTER") continue;
    if (!forbiddenForSeat.has(cardKey(trump, r))) return false;
  }
  return true;
}
