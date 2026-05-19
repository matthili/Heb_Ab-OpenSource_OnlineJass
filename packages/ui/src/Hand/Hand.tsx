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
  /**
   * **Selection-Mode** (z.B. Weisen-Auswahl). Wenn `true`, ignoriert die
   * Hand `canPlay`/`legalMask` und reicht jeden Klick an `onSelect`
   * weiter; selektierte Karten werden visuell „raised" markiert. Der
   * Caller pflegt die `selected`-Liste extern.
   */
  selectionMode?: boolean;
  selected?: readonly CardModel[];
  onSelect?: (card: CardModel) => void;
  /**
   * **WELI-Highlight**: Hebt die WELI-Karte (Schelle-Sechs) mit
   *   1. einer einmaligen Reveal-Animation NACH dem Hand-Deal-Stagger
   *      (Pop nach oben, goldene Aura);
   *   2. einer anhaltenden, dezenten Glüh-Animation, solange diese
   *      Prop true ist.
   * Caller setzt das auf `true`, wenn der eigene Sitz den WELI hat
   * (= ist WELI in `cards`). Default `false` (kein Effekt).
   */
  highlightWeli?: boolean;
}

/**
 * Sortiert Karten nach Farbe (Eichel/Schelle/Herz/Laub, siehe SUIT_ID)
 * und dann nach Rang aufsteigend (Sechs → Sieben → … → Ass). Damit
 * sieht der Spieler immer dasselbe Bild — egal wie der Server die
 * Karten ausgeteilt hat. Reduziert auch die Karten-Sortier-Routine,
 * die jeder echte Jasser sonst manuell vor dem Spiel macht.
 *
 * **Warum nicht trumpf-zentriert?** Weil die Trumpf-Farbe erst nach
 * der Ansage feststeht — eine Re-Sortierung dort wäre verwirrend
 * (Karten springen im Fan). Stattdessen fix nach SUIT_ID.
 */
function sortedHand(cards: readonly CardModel[]): readonly CardModel[] {
  return [...cards].sort((a, b) => {
    const suitDiff = SUIT_ID[a.suit] - SUIT_ID[b.suit];
    if (suitDiff !== 0) return suitDiff;
    return RANK_ID[a.rank] - RANK_ID[b.rank];
  });
}

export function Hand({
  cards,
  legalMask,
  canPlay = false,
  onPlay,
  selectionMode = false,
  selected,
  onSelect,
  highlightWeli = false,
}: HandProps) {
  if (cards.length === 0) {
    return <p className="text-sm text-stone-500 text-center">Keine Karten in der Hand.</p>;
  }
  const sorted = sortedHand(cards);
  // Schnell-Lookup für Selection-Mode: O(1) statt O(N²) im Render-Loop.
  const selectedKeys = new Set((selected ?? []).map((c) => `${c.suit}-${c.rank}`));
  // Überlappung dynamisch nach Kartenzahl: bei 9 Karten brauchen wir
  // stark überlappen, bei 3 reicht moderat. Wir geben ~60 % der Karten-
  // Breite negativen Margin — beim Hover (z-30 + translate-y) hebt sich
  // die einzelne Karte sauber raus.
  const overlap = sorted.length >= 7 ? "-ml-14" : sorted.length >= 5 ? "-ml-10" : "-ml-6";
  return (
    <div
      // Eigener Stacking-Context (`isolate`), damit die `zIndex`-Werte
      // der einzelnen Hand-Karten NICHT mit Geschwister-Elementen
      // (z.B. der Spielfläche darüber) konkurrieren. Sonst können
      // Hand-Karten visuell über die Trick-Karten greifen.
      className="flex justify-center items-end pt-4 pb-2 isolate"
      role="group"
      aria-label="Meine Karten"
    >
      {sorted.map((card, i) => {
        const idx = SUIT_ID[card.suit] * 9 + RANK_ID[card.rank];
        const legal = legalMask ? legalMask[idx] === 1 : true;
        const isSelected = selectionMode && selectedKeys.has(`${card.suit}-${card.rank}`);
        const isWeliCard = card.suit === "SCHELLE" && card.rank === "SECHS";
        // WELI-Reveal startet NACH dem Hand-Deal — animation-delay setzen
        // wir hier explizit auf die ungefähre End-Zeit der Deal-Stagger
        // (i * 60ms Stagger + 500ms Animation = ~1040ms für 9 Karten).
        // Danach läuft die persistente Glow-Animation (Loop) endlos
        // weiter, bis die Karte gespielt wird.
        const weliClasses = highlightWeli && isWeliCard ? "jass-weli-reveal jass-weli-glow" : "";
        const weliStyle =
          highlightWeli && isWeliCard
            ? ({ animationDelay: `${9 * 60 + 100}ms, 2.5s` } as React.CSSProperties)
            : undefined;
        // Im Selection-Mode überschreiben wir Play-Logik:
        //   • alle Karten klickbar (Auswahl-Toggle)
        //   • `raised`, wenn aktuell ausgewählt
        //   • `disabled` greift nicht (eine illegale Spielkarte darf
        //     trotzdem in einem Weis vorkommen)
        const clickable = selectionMode ? Boolean(onSelect) : canPlay && legal && Boolean(onPlay);
        const handleClick = selectionMode ? onSelect : canPlay && legal ? onPlay : undefined;
        return (
          <div
            key={`${card.suit}-${card.rank}-${i}`}
            // `relative` ist nötig, damit `zIndex` überhaupt wirkt.
            // `jass-hand-deal` mit Stagger-Delay: jede Karte fliegt 60ms
            // versetzt ein, wie beim Austeilen am echten Tisch.
            className={`relative jass-hand-deal ${i === 0 ? "" : overlap} hover:z-30 focus-within:z-30`}
            style={{ zIndex: i, animationDelay: `${i * 60}ms` }}
          >
            {/* WELI-Reveal-Wrapper: separater Layer, damit unsere
                Hover-Translates auf der Card nicht mit dem WELI-Animation-
                Transform kollidieren. */}
            <div className={weliClasses} {...(weliStyle ? { style: weliStyle } : {})}>
              <Card
                card={card}
                size="md"
                disabled={!selectionMode && canPlay && !legal}
                raised={isSelected}
                {...(clickable && handleClick ? { onClick: handleClick } : {})}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
