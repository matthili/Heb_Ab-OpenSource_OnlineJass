/**
 * `useDisplayedTrick` — verzögert die Trick-Auflösung um 1,5 s, damit
 * der Spieler sehen kann, welche vierte Karte den Stich gewonnen hat.
 *
 * **Ohne diesen Hook** verschwindet der Stich aus der UI in dem Moment,
 * wo die 4. Karte gespielt wird (Server schickt sofort den Zustand mit
 * `current_trick_cards = []` und `trick_idx + 1`). Damit hat der Spieler
 * keine Chance, die Gewinnerkarte zu sehen.
 *
 * **Mit diesem Hook**: Wenn `current_trick_cards.length` von 4 auf 0
 * fällt, halten wir den alten Stich (aus `completed_tricks[last]`)
 * 1500 ms lang sichtbar und zeigen die Gewinnerkarte mit Ring-Highlight.
 * Danach übergeben wir auf den neuen leeren Trick.
 *
 * Wenn währenddessen der nächste Sitz schon gespielt hätte (KI ist
 * schnell), holen wir den vom Server hinterher — der State wird in einem
 * Ref-buffer gehalten und beim Timer-End angewandt.
 */
import { useEffect, useRef, useState } from "react";

import { trickWinner } from "@jass/engine";
import type { Card, GameState, Variant } from "@jass/engine";

const LINGER_MS = 1500;

export interface DisplayedTrick {
  cards: readonly Card[];
  starter: number; // absolute seat 0..3
  /** Wenn der Stich gerade „eingefroren" gezeigt wird: der Gewinner-Sitz. */
  winnerSeat?: number;
  /** true: wir zeigen einen abgeschlossenen Trick auf Zeit. */
  lingering: boolean;
}

/**
 * Liefert den anzuzeigenden Trick — entweder den live laufenden oder den
 * gerade-eben-fertigen, falls wir noch im Linger-Window sind.
 */
export function useDisplayedTrick(state: GameState | undefined): DisplayedTrick {
  // Aktuelle Live-Werte aus dem State, fallback für „noch nichts da".
  const live: DisplayedTrick = {
    cards: state?.current_trick_cards ?? [],
    starter: state?.current_trick_starter ?? 0,
    lingering: false,
  };

  // State für den „eingefrorenen" Stich; null heißt „kein Linger aktiv".
  const [frozen, setFrozen] = useState<DisplayedTrick | null>(null);
  // Wir merken uns den vorigen Live-Trick, um den 4→0-Übergang zu erkennen.
  const prevRef = useRef<DisplayedTrick>(live);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = live;

    // Übergang erkannt: vorher 4 Karten, jetzt 0 → ein Trick wurde gerade
    // abgeschlossen. Wir zeigen den vorherigen Zustand inklusive Gewinner-
    // Highlight für LINGER_MS Millisekunden.
    if (prev.cards.length === 4 && live.cards.length === 0 && state) {
      const variant: Variant = state.variant;
      const winnerIdx = trickWinner(prev.cards, variant);
      const winnerSeat = (prev.starter + winnerIdx) % 4;
      setFrozen({
        cards: prev.cards,
        starter: prev.starter,
        winnerSeat,
        lingering: true,
      });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setFrozen(null);
      }, LINGER_MS);
    }

    return () => {
      // Bei unmount Timer wegräumen; den setFrozen-Reset machen wir hier
      // bewusst NICHT, sonst kollidiert es mit dem regulären Render-Cycle.
    };
    // state als Abhängigkeit reicht (live wird aus state abgeleitet).
  }, [state]);

  // Cleanup beim Komponent-Unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return frozen ?? live;
}
