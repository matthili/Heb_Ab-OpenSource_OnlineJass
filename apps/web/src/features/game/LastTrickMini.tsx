/**
 * Kleine Anzeige des **vorletzten** abgeschlossenen Stichs in einer Ecke
 * der Spielfläche. So kann man — auch wenn der aktuelle Stich schon
 * teilweise gespielt ist — nochmal nachschauen, welche Karten der
 * letzte Stich enthielt und wer ihn gewonnen hat.
 *
 * Warum „vorletzter" und nicht „letzter"? Weil der **letzte**
 * abgeschlossene Stich (während Linger) noch zentral angezeigt wird;
 * sobald er ausgeblendet ist und der Spielfluss in den nächsten Stich
 * geht, rückt er hier in den Mini-Slot.
 *
 * Hidden, wenn:
 *   - Noch kein Stich abgeschlossen ist (keine completed_tricks)
 *   - Wir gerade im Linger-Modus sind (zentraler Trick zeigt schon den
 *     letzten Stich — Doppel-Darstellung wäre verwirrend)
 */
import type { Card, GameState } from "@jass/engine";
import { trickWinner } from "@jass/engine";

import { Card as CardView } from "@jass/ui";

interface Props {
  state: GameState;
  mySeat: number;
  /** Display-Name pro Sitz für Gewinner-Beschriftung. */
  seatNames: ReadonlyMap<number, string>;
  /** True: wir zeigen den Linger-Trick zentral, also Mini hier ausblenden. */
  hideBecauseLingering: boolean;
}

export function LastTrickMini({ state, mySeat, seatNames, hideBecauseLingering }: Props) {
  const completed = state.completed_tricks;
  if (completed.length === 0 || hideBecauseLingering) {
    return null;
  }
  // Letzter abgeschlossener Stich.
  const last = completed[completed.length - 1]!;
  const winnerIdx = trickWinner(last.cards as Card[], state.variant);
  const winnerSeat = (last.starter + winnerIdx) % 4;
  const winnerName = seatNames.get(winnerSeat) ?? `Sitz ${winnerSeat}`;
  const isMyWin = winnerSeat === mySeat;

  return (
    <aside
      className="rounded-lg bg-stone-100/90 backdrop-blur p-2 shadow-md border border-stone-200 max-w-[18rem]"
      aria-label={`Letzter Stich gewonnen von ${winnerName}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-1 flex items-center justify-between gap-2">
        <span>Letzter Stich</span>
        <span className={isMyWin ? "text-emerald-700 font-semibold" : "text-stone-700"}>
          {isMyWin ? "→ du" : `→ ${winnerName}`}
        </span>
      </div>
      <ol className="flex items-center gap-0.5">
        {last.cards.map((c, i) => {
          const absoluteSeat = (last.starter + i) % 4;
          const isWinnerCard = absoluteSeat === winnerSeat;
          return (
            <li
              key={`${c.suit}-${c.rank}-${i}`}
              className={isWinnerCard ? "ring-2 ring-amber-400 rounded" : ""}
            >
              <CardView card={c} size="xs" />
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
