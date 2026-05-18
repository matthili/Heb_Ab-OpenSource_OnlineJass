/**
 * Spielfläche. Komponenten-Mix:
 *   - `Scoreboard` (Punkte/Trumpf-Anzeige)
 *   - Status-Banner („du bist dran" / Spieler X)
 *   - `PlayingArea`: Sitz-Labels an den 4 Rändern + `Trick` in der Mitte
 *   - `LastTrickMini` in der unteren-rechten Ecke (vorletzter Stich)
 *   - `Hand` mit den eigenen Karten als Fan
 *
 * **Trick-Linger**: Der zentrale Trick wird vom `useDisplayedTrick`-Hook
 * verzögert — wenn die 4. Karte gespielt wird, bleibt der volle Stich
 * inkl. Gewinner-Highlight 1,5 s sichtbar.
 *
 * **Drehrichtung**: Sitz-Labels und Trick-Positionen folgen Uhrzeigersinn
 * (siehe `seat-layout.ts`).
 */
import { Hand, Scoreboard, Trick } from "@jass/ui";
import type { Card } from "@jass/engine";

import type { SeatView } from "~/features/lobby/types";
import { relativeSlot, SEAT_LABEL_POS } from "./seat-layout";
import type { PlayerView } from "./types";
import { useDisplayedTrick } from "./useDisplayedTrick";
import { LastTrickMini } from "./LastTrickMini";

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
  const displayed = useDisplayedTrick(view.state);
  const seatNames = buildSeatNames(seats);

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
      <PlayingArea
        view={view}
        seats={seats}
        mySeat={mySeat}
        displayedCards={displayed.cards}
        displayedStarter={displayed.starter}
        {...(displayed.winnerSeat !== undefined ? { winnerSeat: displayed.winnerSeat } : {})}
        seatNames={seatNames}
        lingering={displayed.lingering}
      />
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
      <div className="rounded bg-jass-cream border border-jass-paperEdge px-3 py-2 text-jass-ink">
        Spiel beendet — siehe Final-Score unten.
      </div>
    );
  }
  if (view.myTurn) {
    return (
      <div className="rounded bg-jass-yellow border border-jass-yellowDark px-3 py-2 text-jass-ink font-semibold">
        Du bist dran.
      </div>
    );
  }
  const playerSeat = seats.find((s) => s.seat === view.whoseTurnSeat);
  const name = playerSeat?.user?.name ?? `KI (Sitz ${view.whoseTurnSeat})`;
  return (
    <div className="rounded bg-jass-paper border border-jass-paperEdge px-3 py-2 text-jass-inkSoft">
      <strong className="text-jass-ink">{name}</strong> ist dran.
    </div>
  );
}

/**
 * Die zentrale Spielfläche: Sitz-Labels an den 4 Rand-Slots, Trick in
 * der Mitte (mit Linger-Effekt), Mini-Anzeige des vorletzten Stichs
 * unten rechts.
 */
function PlayingArea({
  view,
  seats,
  mySeat,
  displayedCards,
  displayedStarter,
  winnerSeat,
  seatNames,
  lingering,
}: {
  view: PlayerView;
  seats: readonly SeatView[];
  mySeat: number;
  displayedCards: readonly Card[];
  displayedStarter: number;
  winnerSeat?: number;
  seatNames: ReadonlyMap<number, string>;
  lingering: boolean;
}) {
  return (
    <div
      className="grid grid-cols-3 grid-rows-3 gap-2 min-h-[20rem] rounded-lg p-4 relative shadow-inner"
      style={{
        backgroundColor: "var(--color-jass-greenDark)",
        backgroundImage:
          "radial-gradient(ellipse at center, color-mix(in srgb, var(--color-jass-green) 60%, transparent), transparent 70%)",
        border: "2px solid var(--color-jass-brownDark)",
      }}
      role="region"
      aria-label="Spielfläche"
    >
      {/* Sitz-Labels der 3 Mitspieler */}
      {seats.map((s) => {
        if (s.seat === mySeat) return null;
        const slot = relativeSlot(s.seat, mySeat);
        const label = s.user?.name ?? (s.aiSeatType ? `KI · ${s.aiSeatType}` : "—");
        const active = view.whoseTurnSeat === s.seat && view.status === "playing";
        const isLastWinner = s.seat === winnerSeat;
        return (
          <div
            key={s.seat}
            className={[
              SEAT_LABEL_POS[slot],
              "text-sm rounded px-2 py-1 z-10 shadow-sm",
              active
                ? "bg-jass-yellow text-jass-ink font-semibold ring-2 ring-jass-yellowDark"
                : isLastWinner
                  ? "bg-jass-cream text-jass-ink border border-jass-yellowDark"
                  : "bg-jass-paper text-jass-ink",
            ].join(" ")}
          >
            {label}
            {isLastWinner && (
              <span className="ml-1 text-jass-yellowDark" aria-hidden="true">
                ★
              </span>
            )}
          </div>
        );
      })}

      {/* Trick in der Mitte — mit Linger-Effekt */}
      <div className="row-start-1 row-end-4 col-start-1 col-end-4 pointer-events-none">
        <Trick
          cards={displayedCards}
          starter={displayedStarter}
          mySeat={mySeat}
          {...(winnerSeat !== undefined ? { winnerSeat } : {})}
        />
      </div>

      {/* Mini-Anzeige des letzten abgeschlossenen Stichs in der unteren
          rechten Ecke. Nur sichtbar, wenn das Linger nicht mehr aktiv
          ist (sonst doppelt). */}
      <div className="row-start-3 col-start-3 self-end justify-self-end z-20 pointer-events-auto">
        <LastTrickMini
          state={view.state}
          mySeat={mySeat}
          seatNames={seatNames}
          hideBecauseLingering={lingering}
        />
      </div>
    </div>
  );
}

function buildSeatNames(seats: readonly SeatView[]): ReadonlyMap<number, string> {
  const m = new Map<number, string>();
  for (const s of seats) {
    m.set(s.seat, s.user?.name ?? (s.aiSeatType ? "KI" : `Sitz ${s.seat}`));
  }
  return m;
}
