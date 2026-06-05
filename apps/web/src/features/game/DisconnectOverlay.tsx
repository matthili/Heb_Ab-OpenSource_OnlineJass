/**
 * **Disconnect-Overlay** — legt sich über das Spielfeld, sobald ein
 * Mitspieler die Verbindung verloren hat. Der Chat-Panel bleibt sichtbar
 * UND bedienbar (das Overlay ist `absolute` im GameBoard-Container,
 * nicht Vollbild-Modal).
 *
 * Phasen-Rendering (siehe `useDisconnectState.DisconnectPhase`):
 *
 *   - **GRACE_1** (2 min): Stiller Countdown, Hinweis „Spieler X hat die
 *     Verbindung verloren". Hoffnung auf Reconnect.
 *   - **VOTE_1** (15 s): Drei große Vote-Karten (STOP/WAIT/FILL). Live-
 *     Anzeige der eingegangenen Stimmen (auch KI-Auto-Votes).
 *   - **GRACE_2** (1 min): Wieder stiller Countdown nach Mehrheits-WAIT.
 *   - **VOTE_2** (15 s): Wie VOTE_1, aber WAIT_AGAIN wird *für alle*
 *     disabled, sobald *irgendjemand* etwas anderes gewählt hat
 *     (Einstimmigkeits-Regel). System-Hinweis kommt parallel im Chat.
 *   - **CONTINUED**: Kurzes „✔ Spiel läuft weiter"-Linger, dann Overlay
 *     verschwindet — primär auf das autoritative `game:disconnect-cleared`
 *     vom Server hin, mit Client-Timer als Fallback (siehe useDisconnectState).
 *   - **CLOSED**: Result-Modal mit OK-Button → Lobby. So weiß ein User,
 *     der zwischenzeitlich was getrunken hat, was passiert ist.
 */
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

import type { SeatView } from "~/features/lobby/types";
import { aiName } from "./aiNames";
import { type DisconnectState, type VoteChoice, useDisconnectState } from "./useDisconnectState";

interface Props {
  gameId: string;
  seats: readonly SeatView[];
  /** Mein Sitz, um „mein eigener Vote"-Highlighting zu zeigen. */
  mySeat: number;
  /** Seed für stabile KI-Namen (Tisch-ID). */
  nameSeed: string;
}

export function DisconnectOverlay({ gameId, seats, mySeat, nameSeed }: Props) {
  const { state, vote, dismissResult } = useDisconnectState(gameId);
  if (!state) return null;
  return (
    <Overlay
      state={state}
      seats={seats}
      mySeat={mySeat}
      nameSeed={nameSeed}
      onVote={vote}
      onDismiss={dismissResult}
    />
  );
}

function Overlay({
  state,
  seats,
  mySeat,
  nameSeed,
  onVote,
  onDismiss,
}: {
  state: DisconnectState;
  seats: readonly SeatView[];
  mySeat: number;
  nameSeed: string;
  onVote: (c: VoteChoice) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const disconnectedNames = state.disconnectedSeats
    .map(
      (d) =>
        seats.find((s) => s.seat === d.seat)?.user?.name ?? t("game.seatFallback", { n: d.seat })
    )
    .join(", ");

  // CLOSED → Result-Modal mit OK → Lobby
  if (state.phase === "CLOSED") {
    return (
      <Backdrop>
        <Card>
          <h2 className="text-xl font-bold text-jass-ink">{t("game.disconnect.closedTitle")}</h2>
          <p className="text-sm text-jass-inkSoft">
            {state.resultMessage ?? t("game.disconnect.closedDefault")}
          </p>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              className="btn-jass-primary"
              onClick={() => {
                onDismiss();
                void navigate({ to: "/lobby" });
              }}
            >
              {t("game.disconnect.toLobby")}
            </button>
          </div>
        </Card>
      </Backdrop>
    );
  }

  // CONTINUED → kurz anzeigen, dann unsichtbar (Server löscht State).
  if (state.phase === "CONTINUED") {
    return (
      <Backdrop>
        <Card>
          <h2 className="text-lg font-semibold text-emerald-700">
            {t("game.disconnect.continuedTitle")}
          </h2>
          <p className="text-sm text-jass-inkSoft">{state.resultMessage}</p>
        </Card>
      </Backdrop>
    );
  }

  // GRACE oder VOTE
  return (
    <Backdrop>
      <Card>
        <header className="space-y-1">
          <h2 className="text-lg font-bold text-jass-ink">{t("game.disconnect.lostTitle")}</h2>
          <p className="text-sm text-jass-inkSoft">
            <Trans
              i18nKey="game.disconnect.lostBody"
              values={{ names: disconnectedNames }}
              components={{ strong: <strong className="text-jass-ink" /> }}
            />
          </p>
        </header>

        <Countdown endsAt={state.phaseEndsAt} />

        {(state.phase === "GRACE_1" || state.phase === "GRACE_2") && (
          <p className="text-sm text-jass-inkSoft">
            {state.phase === "GRACE_1" ? t("game.disconnect.grace1") : t("game.disconnect.grace2")}
          </p>
        )}

        {(state.phase === "VOTE_1" || state.phase === "VOTE_2") && (
          <VoteBlock
            nameSeed={nameSeed}
            state={state}
            seats={seats}
            mySeat={mySeat}
            onVote={onVote}
          />
        )}
      </Card>
    </Backdrop>
  );
}

/**
 * Halbtransparenter Hintergrund über dem GameBoard-Bereich.
 * `absolute inset-0` heißt: parent (GameBoard-Container) muss
 * `relative` sein. Wir kommen NICHT über den Chat-Bereich rechts,
 * weil der außerhalb dieses Containers liegt (Grid-Spalte rechts).
 */
function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="disconnect-title"
      className="absolute inset-0 z-40 flex items-center justify-center bg-stone-900/55 backdrop-blur-sm rounded-lg p-4"
    >
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      id="disconnect-title"
      className="max-w-md w-full rounded-lg bg-jass-paper border border-jass-paperEdge shadow-xl p-5 space-y-4"
    >
      {children}
    </div>
  );
}

function Countdown({ endsAt }: { endsAt: number }) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, endsAt - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setRemainingMs(Math.max(0, endsAt - Date.now())), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  const totalSec = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return (
    <div className="text-center">
      <div className="text-4xl font-mono font-bold text-jass-ink tabular-nums">
        {mm}:{ss.toString().padStart(2, "0")}
      </div>
    </div>
  );
}

function VoteBlock({
  nameSeed,
  state,
  seats,
  mySeat,
  onVote,
}: {
  nameSeed: string;
  state: DisconnectState;
  seats: readonly SeatView[];
  mySeat: number;
  onVote: (c: VoteChoice) => void;
}) {
  const { t } = useTranslation();
  const myVote = state.votes[mySeat];
  const isVote2 = state.phase === "VOTE_2";
  const waitAgainStillAllowed = !isVote2 || !Object.values(state.votes).some((v) => v !== "WAIT");

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-jass-ink">
        {isVote2 ? t("game.disconnect.vote2Prompt") : t("game.disconnect.votePrompt")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <VoteButton
          choice="STOP"
          label={t("game.disconnect.voteStop")}
          subtitle={t("game.disconnect.voteStopSub")}
          color="rose"
          selected={myVote === "STOP"}
          onClick={() => onVote("STOP")}
        />
        <VoteButton
          choice="WAIT"
          label={t("game.disconnect.voteWait")}
          subtitle={
            isVote2
              ? t("game.disconnect.voteWaitSubUnanimous")
              : t("game.disconnect.voteWaitSubReconnect")
          }
          color="amber"
          selected={myVote === "WAIT"}
          disabled={isVote2 && !waitAgainStillAllowed && myVote !== "WAIT"}
          onClick={() => onVote("WAIT")}
        />
        <VoteButton
          choice="FILL"
          label={t("game.disconnect.voteFill")}
          subtitle={t("game.disconnect.voteFillSub")}
          color="emerald"
          selected={myVote === "FILL"}
          onClick={() => onVote("FILL")}
        />
      </div>
      <VoteTally nameSeed={nameSeed} state={state} seats={seats} mySeat={mySeat} />
    </div>
  );
}

function VoteButton({
  label,
  subtitle,
  color,
  selected,
  disabled,
  onClick,
}: {
  choice: VoteChoice;
  label: string;
  subtitle: string;
  color: "rose" | "amber" | "emerald";
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const palette = {
    rose: selected
      ? "bg-rose-600 text-white border-rose-700"
      : "bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100",
    amber: selected
      ? "bg-jass-yellow text-jass-ink border-jass-yellowDark"
      : "bg-jass-cream text-jass-ink border-jass-paperEdge hover:bg-jass-yellow/40",
    emerald: selected
      ? "bg-emerald-600 text-white border-emerald-700"
      : "bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100",
  }[color];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border-2 px-3 py-2 text-sm font-medium ${palette} disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
    >
      <div>{label}</div>
      <div className="text-xs opacity-75">{subtitle}</div>
    </button>
  );
}

/**
 * Stimmübersicht — wer hat schon was gewählt. KIs werden mit 🤖
 * markiert, der eigene Sitz mit „du".
 */
function VoteTally({
  nameSeed,
  state,
  seats,
  mySeat,
}: {
  nameSeed: string;
  state: DisconnectState;
  seats: readonly SeatView[];
  mySeat: number;
}) {
  const { t } = useTranslation();
  // Map alle Stimmen (Mensch + KI) zu einer flachen Liste.
  const all: Array<{ seat: number; choice: VoteChoice; isAi: boolean }> = [];
  for (const seatId in state.votes) {
    all.push({ seat: Number(seatId), choice: state.votes[Number(seatId)]!, isAi: false });
  }
  for (const ai of state.aiAutoVotes) {
    all.push({ seat: ai.seat, choice: ai.choice, isAi: true });
  }
  // Stimmberechtigte Sitze ohne Vote
  const pending = state.participants.filter(
    (p) => p.kind === "HUMAN" && state.votes[p.seat] === undefined
  );

  if (all.length === 0 && pending.length === 0) return null;

  return (
    <ul className="text-xs text-jass-inkSoft space-y-1 border-t border-jass-paperEdge pt-2">
      {all.map((v) => {
        const seatInfo = seats.find((s) => s.seat === v.seat);
        const name = v.isAi
          ? aiName(`${nameSeed}:${v.seat}`, seatInfo?.aiSeatType)
          : v.seat === mySeat
            ? t("game.youSeat", { n: v.seat })
            : (seatInfo?.user?.name ?? t("game.seatFallback", { n: v.seat }));
        return (
          <li key={`v-${v.seat}-${v.isAi}`}>
            {name}: <strong className="text-jass-ink">{labelFor(v.choice, t)}</strong>
          </li>
        );
      })}
      {pending.map((p) => {
        const seatInfo = seats.find((s) => s.seat === p.seat);
        const name =
          p.seat === mySeat
            ? t("game.youSeat", { n: p.seat })
            : (seatInfo?.user?.name ?? t("game.seatFallback", { n: p.seat }));
        return (
          <li key={`p-${p.seat}`} className="italic">
            {name}: {t("game.disconnect.noVoteYet")}
          </li>
        );
      })}
    </ul>
  );
}

function labelFor(c: VoteChoice, t: (key: string) => string): string {
  switch (c) {
    case "STOP":
      return t("game.disconnect.voteStop");
    case "WAIT":
      return t("game.disconnect.voteWait");
    case "FILL":
      return t("game.disconnect.voteFill");
  }
}
