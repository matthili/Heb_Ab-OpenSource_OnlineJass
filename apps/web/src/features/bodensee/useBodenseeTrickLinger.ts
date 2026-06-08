/**
 * `useBodenseeTrickLinger` — hält den gerade-fertigen Stich für ~1,8 s
 * „eingefroren" sichtbar, damit der Spieler sieht, wer gestochen hat —
 * auch wenn der nächste Stich (z. B. der KI-Anspielzug) sofort startet.
 *
 * **Warum nötig?** `BodenseeBoard` zeigt zwar `view.lastTrick`, sobald der
 * laufende Stich leer ist. Sobald aber die nächste Karte gespielt wird,
 * füllt sich `currentTrick` wieder und die Stich-Auflösung verschwindet
 * sofort. Analog zu `useDisplayedTrick` (4er-Variante) frieren wir daher
 * den fertigen Stich kurz ein.
 *
 * **Trigger**: `view.trickIdx` wächst → ein Stich wurde gerade abgeschlossen.
 * Wir merken uns dann `view.lastTrick` und zeigen ihn `LINGER_MS` lang.
 */
import { useEffect, useRef, useState } from "react";

import type { BodenseeView } from "./types";

const LINGER_MS = 1800;

type CompletedTrick = NonNullable<BodenseeView["lastTrick"]>;

export function useBodenseeTrickLinger(view: BodenseeView): CompletedTrick | null {
  const [frozen, setFrozen] = useState<CompletedTrick | null>(null);
  const prevTrickIdx = useRef<number>(view.trickIdx);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (view.trickIdx > prevTrickIdx.current && view.lastTrick) {
      setFrozen(view.lastTrick);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setFrozen(null), LINGER_MS);
    }
    prevTrickIdx.current = view.trickIdx;
  }, [view]);

  // Cleanup beim Unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return frozen;
}
