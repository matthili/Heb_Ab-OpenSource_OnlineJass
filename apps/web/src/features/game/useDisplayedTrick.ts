/**
 * `useDisplayedTrick` — verzögert die Trick-Auflösung um 1,8 s, damit der
 * Spieler sehen kann, welche vierte Karte den Stich gewonnen hat.
 *
 * **Warum nicht „4→0 Karten"-Detection?** Der Server ruft im 4. Move
 * `applyMove` auf, das ohne Umweg den Stich abschließt:
 * `current_trick_cards` springt auf `[]` und `completed_tricks` wächst
 * um 1. Das Frontend sieht NIEMALS einen 4-Karten-Zwischenstand — die
 * 4. Karte ist schon weg, wenn der WS-State ankommt. Deshalb triggern
 * wir den Linger auf **`completed_tricks.length`-Wachstum** statt auf
 * den nie sichtbaren 4-Karten-State.
 *
 * Bei Wachstum: wir nehmen den letzten `completed_tricks`-Eintrag und
 * zeigen ihn samt Gewinner-Highlight 1800 ms lang anstelle des leeren
 * aktuellen Tricks an.
 */
import { useEffect, useRef, useState } from "react";

import { effectiveVariant, trickWinner } from "@jass/engine";
import type { Card, GameState } from "@jass/engine";

const LINGER_MS = 1800;

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
  const live: DisplayedTrick = {
    cards: state?.current_trick_cards ?? [],
    starter: state?.current_trick_starter ?? 0,
    lingering: false,
  };

  // State für den „eingefrorenen" Stich; null heißt „kein Linger aktiv".
  const [frozen, setFrozen] = useState<DisplayedTrick | null>(null);
  // Wachstum von completed_tricks ist unser Trigger: jedes Inkrement
  // bedeutet „ein Stich wurde gerade abgeschlossen".
  const prevCompletedCount = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const completedCount = state?.completed_tricks.length ?? 0;

    if (state && completedCount > prevCompletedCount.current && completedCount > 0) {
      // Der zuletzt abgeschlossene Trick — den frieren wir ein.
      const lastTrick = state.completed_tricks[completedCount - 1]!;
      // WICHTIG (Slalom): `state.variant` ist bereits die Variante des
      // *nächsten* Stichs. Der gerade fertige Stich (Index completedCount-1)
      // wurde unter `effectiveVariant(ann, completedCount-1)` gespielt — sonst
      // wird der Gewinner bei Slalom falsch berechnet (z. B. Herz-10 statt
      // Herz-Ass). Bei Nicht-Slalom liefert effectiveVariant konstant dieselbe.
      const trickVariant = effectiveVariant(state.announcement, completedCount - 1);
      const winnerIdx = trickWinner(lastTrick.cards, trickVariant);
      const winnerSeat = (lastTrick.starter + winnerIdx) % 4;
      setFrozen({
        cards: lastTrick.cards,
        starter: lastTrick.starter,
        winnerSeat,
        lingering: true,
      });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setFrozen(null), LINGER_MS);
    }

    prevCompletedCount.current = completedCount;
  }, [state]);

  // Cleanup beim Komponent-Unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return frozen ?? live;
}
