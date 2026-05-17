/**
 * Spielfläche. Setzt jetzt (seit M7-E) auf die `@jass/ui`-Komponenten
 * Scoreboard / Trick / Hand. Eigene Logik hier:
 *   - Sitz-Slots der Mitspieler (Avatar/Name) am Rand der Spielfläche
 *   - Status-Banner (Du bist dran / Spieler X / fertig)
 *   - Trick-Winner-Berechnung über die Engine
 */
import { Hand, Scoreboard, Trick } from "@jass/ui";
import type { Card } from "@jass/engine";
import { trickWinner } from "@jass/engine";

import type { SeatView } from "~/features/lobby/types";
import { relativeSlot, SEAT_LABEL_POS } from "./seat-layout";
import type { PlayerView } from "./types";

interface Props {
  view: PlayerView;
  seats: readonly SeatView[];
  mySeat: number;
  movePending: boolean;
  error: string | null;
  onPlayCard: (card: Card) => void;
}

export function GameBoard({ view, seats, mySeat, movePending, error, onPlayCard }: Props) {
  const variant = view.state.variant;
  return (
    <div className="space-y-4">
      <Scoreboard
        ownTeamScore={view.state.own_team_score}
        oppTeamScore={view.state.opp_team_score}
        trickIdx={view.state.trick_idx}
        mode={variant.mode}
        {...(variant.trump_suit !== undefined ? { trumpSuit: variant.trump_suit } : {})}
      />
      <StatusBanner view={view} seats={seats} />
      {error && (
        <div
          role="alert"
          className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </div>
      )}
      <PlayingArea view={view} seats={seats} mySeat={mySeat} />
      <Hand
        cards={view.hand}
        legalMask={view.legalActionMask}
        canPlay={view.myTurn && !movePending}
        onPlay={onPlayCard}
      />
    </div>
  );
}

function StatusBanner({ view, seats }: { view: PlayerView; seats: readonly SeatView[] }) {
  if (view.status === "finished") {
    return (
      <div className="rounded bg-violet-50 border border-violet-200 px-3 py-2 text-violet-900">
        Spiel beendet — siehe Final-Score unten.
      </div>
    );
  }
  if (view.myTurn) {
    return (
      <div className="rounded bg-amber-100 border border-amber-300 px-3 py-2 text-amber-900 font-medium">
        Du bist dran.
      </div>
    );
  }
  const playerSeat = seats.find((s) => s.seat === view.whoseTurnSeat);
  const name = playerSeat?.user?.name ?? `KI (Sitz ${view.whoseTurnSeat})`;
  return (
    <div className="rounded bg-stone-100 border border-stone-200 px-3 py-2 text-stone-700">
      <strong>{name}</strong> ist dran.
    </div>
  );
}

/**
 * Die zentrale Spielfläche: Sitz-Labels an den 4 Rand-Slots + Trick in
 * der Mitte. Der Trick-Slot ist eine eigene 3×3-Sub-Grid (über die
 * `Trick`-Komponente), die wir mittig auf das große 3×3-Grid setzen.
 */
function PlayingArea({
  view,
  seats,
  mySeat,
}: {
  view: PlayerView;
  seats: readonly SeatView[];
  mySeat: number;
}) {
  // Trick-Winner-Highlight: wenn alle 4 Karten liegen, berechnen wir den
  // Sieger über die Engine. Bei < 4 Karten ist noch kein Winner.
  const trickCards = view.state.current_trick_cards;
  const trickStarter = view.state.current_trick_starter;
  let winnerSeat: number | undefined;
  if (trickCards.length === 4) {
    const winnerIdx = trickWinner(trickCards, view.state.variant);
    winnerSeat = (trickStarter + winnerIdx) % 4;
  }

  return (
    <div
      className="grid grid-cols-3 grid-rows-3 gap-2 min-h-[18rem] bg-emerald-50 border border-emerald-200 rounded-lg p-4 relative"
      role="region"
      aria-label="Spielfläche"
    >
      {/* Sitz-Labels in den drei Mitspieler-Slots */}
      {seats.map((s) => {
        if (s.seat === mySeat) return null;
        const slot = relativeSlot(s.seat, mySeat);
        const label = s.user?.name ?? (s.aiSeatType ? `KI · ${s.aiSeatType}` : "—");
        const active = view.whoseTurnSeat === s.seat && view.status === "playing";
        return (
          <div
            key={s.seat}
            className={`${SEAT_LABEL_POS[slot]} text-sm rounded px-2 py-1 z-10 ${
              active ? "bg-amber-200 text-amber-900 font-medium" : "bg-white text-stone-700"
            }`}
          >
            {label}
          </div>
        );
      })}

      {/* Trick in der Mitte — eigener Container mit Trick-Komponente,
          die ein 3×3-Sub-Grid füllt. Wir lassen es über die ganze
          Spielfläche spannen, damit die vier Slots zu den
          Sitz-Labels am Rand passen. */}
      <div className="row-start-1 row-end-4 col-start-1 col-end-4 pointer-events-none">
        <Trick
          cards={trickCards}
          starter={trickStarter}
          mySeat={mySeat}
          {...(winnerSeat !== undefined ? { winnerSeat } : {})}
        />
      </div>
    </div>
  );
}
