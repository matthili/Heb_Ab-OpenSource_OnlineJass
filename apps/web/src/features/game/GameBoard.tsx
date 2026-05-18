/**
 * Spielfläche. Komponenten-Mix:
 *   - `Scoreboard` (Punkte/Trumpf-Anzeige)
 *   - Status-Banner („du bist dran" / Spieler X)
 *   - `PlayingArea`: Sitz-Labels an den 4 Rändern + `Trick` in der Mitte
 *   - `TrickMini` in den unteren Ecken (links: erster Stich der Runde,
 *     rechts: letzter abgeschlossener Stich)
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
import { Link } from "@tanstack/react-router";

import type { SeatView } from "~/features/lobby/types";
import { AnnouncementDialog } from "./AnnouncementDialog";
import { relativeSlot, SEAT_LABEL_POS } from "./seat-layout";
import type { AnnouncementDecision, PlayerView } from "./types";
import { useDisplayedTrick } from "./useDisplayedTrick";
import { TrickMini } from "./TrickMini";

interface Props {
  view: PlayerView;
  seats: readonly SeatView[];
  mySeat: number;
  movePending: boolean;
  announcePending: boolean;
  error: string | null;
  onPlayCard: (card: Card) => void;
  onAnnounce: (decision: AnnouncementDecision) => void;
  onAnnounceStoeck: () => void;
}

export function GameBoard({
  view,
  seats,
  mySeat,
  movePending,
  announcePending,
  error,
  onPlayCard,
  onAnnounce,
  onAnnounceStoeck,
}: Props) {
  const seatNames = buildSeatNames(seats);
  // Hook IMMER auf gleichem Render-Level aufrufen — auch im Ansage-Modus,
  // damit React keine "different number of hooks"-Warnung wirft. Der Hook
  // toleriert `undefined` als no-op.
  const displayed = useDisplayedTrick(view.state ?? undefined);

  // Ansage-Phase: nur die Hand + Dialog rendern, kein Scoreboard/Spielfeld.
  // Die Variante steht ja noch gar nicht fest, das Scoreboard hätte nichts
  // sinnvolles anzuzeigen.
  if (view.status === "announcing") {
    return (
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
          >
            {error}
          </div>
        )}
        <AnnouncementDialog
          view={view}
          seatNames={seatNames}
          pending={announcePending}
          onAnnounce={onAnnounce}
        />
        {/* Hand zeigen, damit der Ansager beim Auswählen seine Karten sieht. */}
        <Hand cards={view.hand} />
      </div>
    );
  }

  // ─── Playing / Finished: regulärer Game-Board-Render ────────────────
  const state = view.state!; // status !== announcing → state ist garantiert da
  const variant = state.variant;

  return (
    <div className="space-y-4">
      <Scoreboard
        ownTeamScore={state.own_team_score}
        oppTeamScore={state.opp_team_score}
        trickIdx={state.trick_idx}
        mode={variant.mode}
        {...(variant.trump_suit !== undefined ? { trumpSuit: variant.trump_suit } : {})}
      />
      <StatusBanner view={view} seats={seats} />
      {view.stoeckEligible && (
        <button
          type="button"
          onClick={onAnnounceStoeck}
          className="w-full rounded-lg bg-jass-yellow border-2 border-jass-yellowDark px-4 py-3 text-jass-ink font-bold text-lg shadow-md hover:bg-jass-yellow/90 jass-your-turn-glow"
        >
          ★ Stöck rufen (+20)
        </button>
      )}
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
        state={state}
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
      <div className="jass-your-turn-glow rounded bg-jass-yellow border border-jass-yellowDark px-3 py-2 text-jass-ink font-semibold">
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
  state,
  seats,
  mySeat,
  displayedCards,
  displayedStarter,
  winnerSeat,
  seatNames,
  lingering,
}: {
  view: PlayerView;
  state: NonNullable<PlayerView["state"]>;
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
      // Spielfläche mit Filz-Textur (bg-jass-felt — CSS-Pattern aus
      // gekreuzten Linear-Gradients, kein PNG). Min-Höhe 32rem damit die
      // h-32-Karten in den 3×3-Slots ohne Überlappung passen; clamp
      // skaliert auf großen Bildschirmen bis 48rem hoch.
      className="grid grid-cols-3 grid-rows-[auto_1fr_auto] gap-2 min-h-[32rem] h-[clamp(32rem,65vh,48rem)] rounded-lg p-4 relative shadow-inner bg-jass-felt"
      style={{ border: "2px solid var(--color-jass-brownDark)" }}
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
        const wrapperCls = [
          SEAT_LABEL_POS[slot],
          "text-sm rounded px-2 py-1 z-10 shadow-sm",
          active
            ? "bg-jass-yellow text-jass-ink font-semibold ring-2 ring-jass-yellowDark jass-seat-active-pulse"
            : isLastWinner
              ? "bg-jass-cream text-jass-ink border border-jass-yellowDark"
              : "bg-jass-paper text-jass-ink",
        ].join(" ");
        const content = (
          <>
            {label}
            {isLastWinner && (
              <span className="ml-1 text-jass-yellowDark" aria-hidden="true">
                ★
              </span>
            )}
          </>
        );
        // Menschliche Sitze sind klickbar → Public-Profile. KI-Sitze
        // bleiben statische Labels (kein Profil zum Anzeigen).
        if (s.user?.id) {
          return (
            <Link
              key={s.seat}
              to="/users/$id"
              params={{ id: s.user.id }}
              className={`${wrapperCls} hover:underline pointer-events-auto`}
            >
              {content}
            </Link>
          );
        }
        return (
          <div key={s.seat} className={wrapperCls}>
            {content}
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

      {/* Erster Stich der Runde — unten links, bleibt sichtbar
          während der ganzen Runde (Vorarlberger Tradition: man darf
          den ersten Stich nochmal anschauen). */}
      <div className="row-start-3 col-start-1 self-end justify-self-start z-20 pointer-events-auto">
        <TrickMini state={state} mySeat={mySeat} seatNames={seatNames} which="first" />
      </div>

      {/* Letzter abgeschlossener Stich — unten rechts. Während Linger
          ausgeblendet (zentrale Anzeige zeigt ihn schon). */}
      <div className="row-start-3 col-start-3 self-end justify-self-end z-20 pointer-events-auto">
        <TrickMini
          state={state}
          mySeat={mySeat}
          seatNames={seatNames}
          which="last"
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
