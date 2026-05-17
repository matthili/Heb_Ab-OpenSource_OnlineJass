/**
 * Hand-Komponente — eigene Karten am unteren Bildschirmrand.
 *
 * **Klickbar-Logik**: Nur wenn `canPlay` UND die Karte in `legalMask=1`,
 * triggert `onPlay` beim Klick. Nicht-legale Karten sind `disabled`
 * (50 % opacity), so dass der Spieler sieht „darf ich, aber illegal" vs.
 * „bin gar nicht dran" (dann ist `canPlay=false` und alle Karten sind
 * nicht-disabled, aber nicht klickbar).
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
  return (
    <div className="flex justify-center gap-1 flex-wrap" role="group" aria-label="Meine Karten">
      {cards.map((card, i) => {
        const idx = SUIT_ID[card.suit] * 9 + RANK_ID[card.rank];
        const legal = legalMask ? legalMask[idx] === 1 : true;
        const clickable = canPlay && legal && Boolean(onPlay);
        return (
          <Card
            key={`${card.suit}-${card.rank}-${i}`}
            card={card}
            size="md"
            disabled={canPlay && !legal}
            {...(clickable && onPlay ? { onClick: onPlay } : {})}
          />
        );
      })}
    </div>
  );
}
