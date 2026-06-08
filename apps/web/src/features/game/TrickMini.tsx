/**
 * Kleine Anzeige eines abgeschlossenen Stichs in einer Ecke der
 * Spielfläche.
 *
 * Wird genutzt für:
 *   - **Erster Stich** (`which="first"`): bleibt während der ganzen
 *     Runde sichtbar, sobald der erste Stich abgeschlossen ist. Vorarl-
 *     berger Tradition: man darf den ersten Stich nochmal ansehen, weil
 *     er Hinweise auf die Hände der Mitspieler gibt.
 *   - **Letzter Stich** (`which="last"`): zeigt den zuletzt abgeschlos-
 *     senen Stich (also `completed_tricks[last]`). Wird während des
 *     zentralen Linger ausgeblendet (`hideBecauseLingering`), weil der
 *     dort zentral gezeigt wird — sonst Doppel-Darstellung.
 *
 * Wenn nur 1 Stich abgeschlossen ist, sind „first" und „last" identisch;
 * dann zeigen wir nur die `first`-Box (die hat `hideBecauseLingering`
 * nicht gesetzt), und die `last`-Box bleibt während Linger versteckt
 * und ist nach Linger redundant — sie blendet sich dann selbst aus.
 */
import type { Card, GameState } from "@jass/engine";
import { effectiveVariant, trickWinner } from "@jass/engine";
import { useTranslation } from "react-i18next";

import { Card as CardView } from "@jass/ui";

interface Props {
  state: GameState;
  mySeat: number;
  /** Display-Name pro Sitz für Gewinner-Beschriftung. */
  seatNames: ReadonlyMap<number, string>;
  /** Welcher Stich? */
  which: "first" | "last";
  /**
   * Nur für `which="last"` relevant: während der zentrale Linger den
   * letzten Stich gerade groß zeigt, ist die kleine Anzeige redundant
   * und wird ausgeblendet.
   */
  hideBecauseLingering?: boolean;
}

export function TrickMini({
  state,
  mySeat,
  seatNames,
  which,
  hideBecauseLingering = false,
}: Props) {
  const { t } = useTranslation();
  const completed = state.completed_tricks;
  if (completed.length === 0) return null;

  // Index in completed_tricks
  const trickIdx = which === "first" ? 0 : completed.length - 1;
  const trick = completed[trickIdx]!;

  // „last" während Linger ausblenden — der zentrale Trick zeigt ihn
  // schon. Ausnahme: wenn erst 1 Stich abgeschlossen ist, dann ist der
  // „first" = „last" — der first-Box reicht, last bleibt versteckt.
  if (which === "last") {
    if (hideBecauseLingering) return null;
    if (completed.length === 1) return null; // first zeigt schon dasselbe
  }

  // Slalom: jeder Stich hat seine eigene effektive Variante (Oben/Unten
  // alternierend). `state.variant` gilt nur für den AKTUELLEN Stich — den
  // abgeschlossenen Stich `trickIdx` müssen wir mit seiner eigenen Variante
  // auswerten, sonst leuchtet die falsche Karte als Gewinner.
  const trickVariant = effectiveVariant(state.announcement, trickIdx);
  const winnerIdx = trickWinner(trick.cards as Card[], trickVariant);
  const winnerSeat = (trick.starter + winnerIdx) % 4;
  const winnerName = seatNames.get(winnerSeat) ?? t("game.seatFallback", { n: winnerSeat });
  const isMyWin = winnerSeat === mySeat;
  const label = which === "first" ? t("game.trickMini.first") : t("game.trickMini.last");

  return (
    <aside
      className="rounded-lg bg-stone-100/90 backdrop-blur p-2 shadow-md border border-stone-200 max-w-[16rem]"
      aria-label={t("game.trickMini.wonByAria", { label, name: winnerName })}
    >
      <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-1 flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className={isMyWin ? "text-emerald-700 font-semibold" : "text-stone-700"}>
          {isMyWin
            ? t("game.trickMini.wonByYou")
            : t("game.trickMini.wonByName", { name: winnerName })}
        </span>
      </div>
      <ol className="flex items-center gap-0.5">
        {trick.cards.map((c, i) => {
          const absoluteSeat = (trick.starter + i) % 4;
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
