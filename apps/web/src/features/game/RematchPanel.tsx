/**
 * Re-Match-Vote-Panel — zeigt nach Spielende den Final-Score und einen
 * prominenten „Weiter spielen"-Button.
 *
 * **Flow** (User-Spec aus Demo-Feedback):
 *   - Großer „Weiter"-Button als Hauptaktion (= YES vote).
 *   - Daneben dezent „Aufhören" (= NO vote, Tisch geht zurück nach WAITING).
 *   - **10-Sekunden-Auto-YES**: wenn der User innerhalb 10 s nicht klickt,
 *     wird YES automatisch ausgelöst.
 *   - Nach dem Vote: Status-Anzeige.
 *
 * **Solo-Jass**: erkennt 4 Konten an `finalScore.team_card_points.length`.
 * Final-Score + Partie-Stand zeigen dann 4 Einzelspieler statt 2 Teams.
 *
 * Outcome-Events kommen via WS (`game:rematch-decided`) — die werden im
 * Eltern-Component (TableDetail) gehandhabt.
 */
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { SeatView } from "~/features/lobby/types";
import { api, ApiError } from "~/lib/api";
import type { FinalScore, RematchOutcome } from "./types";

const AUTO_YES_SECONDS = 10;

interface Props {
  gameId: string;
  finalScore: FinalScore | undefined;
  /** Kumulative Partie-Stände (2 bei Kreuz, 4 bei Solo). */
  cumulativeScores?: readonly number[];
  /** Punkteziel der Partie (z.B. 1000 / Solo 500). */
  targetScore?: number;
  /** Sitze des Tisches — für die Namens-Auflösung im Solo-Modus. */
  seats?: readonly SeatView[];
  /** Eigener Sitz — wird im Solo-Final-Score mit „du" markiert. */
  mySeat?: number;
}

export function RematchPanel({
  gameId,
  finalScore,
  cumulativeScores,
  targetScore,
  seats,
  mySeat,
}: Props) {
  const [myVote, setMyVote] = useState<"YES" | "NO" | null>(null);
  const [outcome, setOutcome] = useState<RematchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_YES_SECONDS);

  const voteMut = useMutation({
    mutationFn: (vote: "YES" | "NO") =>
      api<RematchOutcome>(`/api/games/${gameId}/rematch-vote`, {
        method: "POST",
        body: { vote },
      }),
    onSuccess: (result, vote) => {
      setMyVote(vote);
      setOutcome(result);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Vote fehlgeschlagen.");
    },
  });

  // Auto-YES-Countdown: läuft, solange noch nicht gevotet wurde.
  useEffect(() => {
    if (myVote !== null) return;
    if (secondsLeft <= 0) {
      voteMut.mutate("YES");
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, myVote, voteMut]);

  // Solo = 4 Punkte-Konten im Final-Score.
  const isSolo = (finalScore?.team_card_points.length ?? 2) === 4;

  /** Namens-Auflösung für einen Sitz (Solo: Team-ID == Sitz). */
  function seatLabel(seat: number): string {
    if (seat === mySeat) return "Du";
    const s = seats?.find((x) => x.seat === seat);
    if (s?.user) return s.user.name;
    if (s?.aiSeatType) return `KI (Sitz ${seat + 1})`;
    return `Sitz ${seat + 1}`;
  }

  return (
    <section className="space-y-4 rounded-lg border border-jass-paperEdge bg-jass-cream p-4 shadow-sm">
      <h2 className="text-xl font-bold text-jass-ink">Spiel beendet</h2>

      {finalScore && <FinalScoreView score={finalScore} isSolo={isSolo} seatLabel={seatLabel} />}

      {targetScore !== undefined && cumulativeScores !== undefined && (
        <MatchProgress
          scores={cumulativeScores}
          target={targetScore}
          isSolo={isSolo}
          seatLabel={seatLabel}
        />
      )}

      {!myVote ? (
        <div className="space-y-2">
          <p className="text-jass-ink">Bereit für die nächste Runde?</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => voteMut.mutate("YES")}
              disabled={voteMut.isPending}
              className="btn-jass-primary text-base"
            >
              ▶ Weiter
            </button>
            <button
              type="button"
              onClick={() => voteMut.mutate("NO")}
              disabled={voteMut.isPending}
              className="text-sm text-jass-inkSoft underline hover:text-jass-ink disabled:opacity-50"
            >
              Aufhören
            </button>
            <span className="ml-auto text-xs text-jass-inkSoft tabular-nums">
              Auto-Start in <strong>{secondsLeft}</strong> s
            </span>
          </div>
        </div>
      ) : (
        <RematchStatus vote={myVote} outcome={outcome} />
      )}

      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}

function FinalScoreView({
  score,
  isSolo,
  seatLabel,
}: {
  score: FinalScore;
  isSolo: boolean;
  seatLabel: (seat: number) => string;
}) {
  const pts = score.team_card_points;
  const sum = pts.reduce((a, b) => a + b, 0);
  // Sieger = Konto mit den meisten Punkten (eindeutig oder null bei Gleichstand).
  const max = Math.max(...pts);
  const leaders = pts.filter((p) => p === max).length;
  const winner = leaders === 1 ? pts.indexOf(max) : null;

  return (
    <div className="rounded border border-jass-paperEdge bg-jass-paper px-4 py-3 space-y-1">
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-medium text-jass-ink">
        {pts.map((p, i) => (
          <span key={i} className={winner === i ? "font-bold" : undefined}>
            {isSolo ? seatLabel(i) : i === 0 ? "Team 0 (Sitz 1+3)" : "Team 1 (Sitz 2+4)"}:{" "}
            <strong>{p}</strong>
          </span>
        ))}
      </div>
      <p className="text-sm text-jass-inkSoft">
        Summe: {sum}{" "}
        {score.matsch_team !== null && (
          <>· Matsch für {isSolo ? seatLabel(score.matsch_team) : `Team ${score.matsch_team}`}!</>
        )}
        {winner !== null && <> · Sieg: {isSolo ? seatLabel(winner) : `Team ${winner}`}</>}
      </p>
    </div>
  );
}

function RematchStatus({ vote, outcome }: { vote: "YES" | "NO"; outcome: RematchOutcome | null }) {
  if (!outcome) return null;
  if (outcome.kind === "pending") {
    return (
      <div className="rounded bg-jass-paper border border-jass-paperEdge px-3 py-2 text-sm text-jass-ink">
        Du hast „{vote === "YES" ? "weiter" : "aufhören"}" gewählt. Warten auf{" "}
        {outcome.remainingVotes}{" "}
        {outcome.remainingVotes === 1 ? "weiteren Spieler" : "weitere Spieler"} …
      </div>
    );
  }
  if (outcome.kind === "rematch-started") {
    return (
      <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">
        Nächste Runde startet. (Tisch wechselt automatisch zum neuen Game.)
      </div>
    );
  }
  return (
    <div className="rounded bg-violet-50 border border-violet-200 px-3 py-2 text-sm text-violet-900">
      Nicht alle wollen weiterspielen. Der Tisch geht zurück in die Warte-Phase.
    </div>
  );
}

/**
 * Partie-Fortschritt-Anzeige: kumulative Scores + Ziel. Bei Kreuz 2
 * Team-Zeilen, bei Solo 4 Spieler-Zeilen.
 */
function MatchProgress({
  scores,
  target,
  isSolo,
  seatLabel,
}: {
  scores: readonly number[];
  target: number;
  isSolo: boolean;
  seatLabel: (seat: number) => string;
}) {
  const max = Math.max(...scores, 0);
  const remaining = Math.max(0, target - max);
  return (
    <div className="rounded border border-jass-paperEdge bg-jass-paper px-4 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs uppercase tracking-wide text-jass-inkSoft">Partie-Stand</span>
        {scores.map((s, i) => (
          <span
            key={i}
            className={s === max && max > 0 ? "font-bold text-jass-ink" : "text-jass-inkSoft"}
          >
            {isSolo ? seatLabel(i) : `Team ${i}`}: {s}
          </span>
        ))}
        <span className="ml-auto text-xs text-jass-inkSoft">
          Ziel: <strong className="text-jass-ink">{target}</strong>
          {remaining > 0 && <> · noch {remaining} Punkte</>}
        </span>
      </div>
    </div>
  );
}
