/**
 * Spielfläche. Layout (3×3-Grid, eigener Sitz ist „unten"):
 *
 *     [top]
 * [left]  [trick]  [right]
 *     [bottom = ich]
 *     [hand]
 *
 * Trick wird mittig in 4 Positionen ausgespielt, jeder Spieler an
 * seinem Slot. Eigene Hand am unteren Rand, klickbar wenn myTurn + legal.
 */
import { Card as CardComponent } from "@jass/ui";
import type { Card } from "@jass/engine";
import { RANK_ID, SUIT_ID } from "@jass/engine";

import type { SeatView } from "~/features/lobby/types";
import { relativeSlot, SEAT_LABEL_POS, TRICK_SLOT_POS } from "./seat-layout";
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
  return (
    <div className="space-y-4">
      <ScorePanel view={view} />
      <StatusBanner view={view} seats={seats} />
      {error && (
        <div
          role="alert"
          className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </div>
      )}
      <BoardGrid view={view} seats={seats} mySeat={mySeat} />
      <HandRow
        hand={view.hand}
        legalMask={view.legalActionMask}
        canPlay={view.myTurn && !movePending}
        onPlay={onPlayCard}
      />
    </div>
  );
}

function ScorePanel({ view }: { view: PlayerView }) {
  const own = view.state.own_team_score;
  const opp = view.state.opp_team_score;
  return (
    <div className="flex gap-4 text-sm border-b border-stone-200 pb-2">
      <span>
        Eigenes Team: <strong>{own}</strong>
      </span>
      <span>
        Gegner: <strong>{opp}</strong>
      </span>
      <span className="ml-auto text-stone-500">Stich {view.state.trick_idx + 1} / 9</span>
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

function BoardGrid({
  view,
  seats,
  mySeat,
}: {
  view: PlayerView;
  seats: readonly SeatView[];
  mySeat: number;
}) {
  const trickCards = view.state.current_trick_cards;
  const trickStarter = view.state.current_trick_starter;

  return (
    <div
      className="grid grid-cols-3 grid-rows-4 gap-2 min-h-[26rem] bg-emerald-50 border border-emerald-200 rounded-lg p-4"
      role="region"
      aria-label="Spielfläche"
    >
      {/* Sitz-Labels in den vier Slots */}
      {seats.map((s) => {
        if (s.seat === mySeat) return null; // eigener Sitz braucht keinen Label-Block
        const slot = relativeSlot(s.seat, mySeat);
        const label = s.user?.name ?? (s.aiSeatType ? `KI · ${s.aiSeatType}` : "—");
        const active = view.whoseTurnSeat === s.seat && view.status === "playing";
        return (
          <div
            key={s.seat}
            className={`${SEAT_LABEL_POS[slot]} text-sm rounded px-2 py-1 ${
              active ? "bg-amber-200 text-amber-900 font-medium" : "bg-white text-stone-700"
            }`}
          >
            {label}
          </div>
        );
      })}

      {/* Trick-Karten je nach Slot */}
      {trickCards.map((c, i) => {
        const absoluteSeat = (trickStarter + i) % 4;
        const slot = relativeSlot(absoluteSeat, mySeat);
        return (
          <div key={`${c.suit}-${c.rank}-${i}`} className={TRICK_SLOT_POS[slot]}>
            <CardComponent card={c} size="sm" />
          </div>
        );
      })}
    </div>
  );
}

function HandRow({
  hand,
  legalMask,
  canPlay,
  onPlay,
}: {
  hand: readonly Card[];
  legalMask: readonly number[];
  canPlay: boolean;
  onPlay: (card: Card) => void;
}) {
  if (hand.length === 0) {
    return <p className="text-sm text-stone-500 text-center">Keine Karten mehr in der Hand.</p>;
  }
  return (
    <div className="flex justify-center gap-1 flex-wrap" role="group" aria-label="Meine Karten">
      {hand.map((card, i) => {
        const idx = SUIT_ID[card.suit] * 9 + RANK_ID[card.rank];
        const legal = legalMask[idx] === 1;
        const clickable = canPlay && legal;
        return (
          <CardComponent
            key={`${card.suit}-${card.rank}-${i}`}
            card={card}
            size="md"
            disabled={canPlay && !legal}
            {...(clickable ? { onClick: onPlay } : {})}
          />
        );
      })}
    </div>
  );
}
