/**
 * Hand-Komponente — eigene Karten am unteren Bildschirmrand.
 *
 * **Layout**: Karten überlappen mit negativem Margin, sodass alle 9
 * Karten auch auf schmalen Bildschirmen nebeneinander Platz haben. Die
 * Überlappung wird mit `--card-overlap` (CSS-Variable) gesteuert; ein
 * Container-Query verkleinert sie auf kleineren Screens. Beim Hover hebt
 * sich die einzelne Karte raus dem Stapel, sodass man sie ganz sieht.
 *
 * **Klickbar-Logik**: Nur wenn `canPlay` UND die Karte in `legalMask=1`,
 * triggert `onPlay` beim Klick. Nicht-legale Karten sind `disabled`
 * (ausgegraut), so dass der Spieler sieht „darf ich, aber illegal" vs.
 * „bin gar nicht dran" (dann `canPlay=false`, alle Karten sichtbar aber
 * inaktiv).
 *
 * **Mask-Format**: 36-Bit-Maske aus der Engine (`SUIT_ID * 9 + RANK_ID`).
 * Caller pflegt das selbst — die Hand-Komponente kennt den Engine-Index
 * nicht.
 */
import type { Card as CardModel } from "@jass/engine";
import { RANK_ID, SUIT_ID } from "@jass/engine";

import { Card } from "../Card/Card.js";

export interface HandProps {
  cards: readonly CardModel[];
  /** 36-Bit-Maske, optional. Wenn nicht gegeben, alle Karten als legal. */
  legalMask?: readonly number[];
  /** Wenn true UND Karte ist legal → klickbar. */
  canPlay?: boolean;
  /** Click-Handler. Nur aufgerufen wenn `canPlay && legal`. */
  onPlay?: (card: CardModel) => void;
}

export function Hand({ cards, legalMask, canPlay = false, onPlay }: HandProps) {
  if (cards.length === 0) {
    return <p className="text-sm text-stone-500 text-center">Keine Karten in der Hand.</p>;
  }
  // Überlappung dynamisch nach Kartenzahl: bei 9 Karten brauchen wir
  // stark überlappen, bei 3 reicht moderat. Wir geben ~60 % der Karten-
  // Breite negativen Margin — beim Hover (z-30 + translate-y) hebt sich
  // die einzelne Karte sauber raus.
  const overlap = cards.length >= 7 ? "-ml-14" : cards.length >= 5 ? "-ml-10" : "-ml-6";
  return (
    <div className="flex justify-center items-end pt-4 pb-2" role="group" aria-label="Meine Karten">
      {cards.map((card, i) => {
        const idx = SUIT_ID[card.suit] * 9 + RANK_ID[card.rank];
        const legal = legalMask ? legalMask[idx] === 1 : true;
        const clickable = canPlay && legal && Boolean(onPlay);
        return (
          <div
            key={`${card.suit}-${card.rank}-${i}`}
            className={`${i === 0 ? "" : overlap} hover:z-30 focus-within:z-30`}
            style={{ zIndex: i }}
          >
            <Card
              card={card}
              size="md"
              disabled={canPlay && !legal}
              {...(clickable && onPlay ? { onClick: onPlay } : {})}
            />
          </div>
        );
      })}
    </div>
  );
}
