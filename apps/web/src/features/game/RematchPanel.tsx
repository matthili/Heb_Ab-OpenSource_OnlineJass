/**
 * Re-Match-Vote-Panel — zeigt nach Spielende den Final-Score und die
 * YES/NO-Buttons. Nach dem eigenen Vote wird der Knopf disabled +
 * Wartehinweis.
 *
 * Outcome-Events kommen via WS (`game:rematch-decided`) — die werden im
 * Eltern-Component (TableDetail) gehandhabt. Hier ist nur die Anzeige
 * + Vote-API-Call.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api, ApiError } from "~/lib/api";
import type { FinalScore, RematchOutcome } from "./types";

interface Props {
  gameId: string;
  finalScore: FinalScore | undefined;
}

export function RematchPanel({ gameId, finalScore }: Props) {
  const [myVote, setMyVote] = useState<"YES" | "NO" | null>(null);
  const [outcome, setOutcome] = useState<RematchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">Spiel beendet</h2>

      {finalScore && <FinalScoreView score={finalScore} />}

      {!myVote ? (
        <div className="space-y-2">
          <p>Nochmal eine Runde?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => voteMut.mutate("YES")}
              disabled={voteMut.isPending}
              className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Ja, nochmal!
            </button>
            <button
              type="button"
              onClick={() => voteMut.mutate("NO")}
              disabled={voteMut.isPending}
              className="rounded border border-stone-300 px-4 py-2 hover:bg-stone-100 disabled:opacity-50"
            >
              Nein, raus
            </button>
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

function FinalScoreView({ score }: { score: FinalScore }) {
  const sum = score.team_card_points.reduce((a, b) => a + b, 0);
  const winner =
    (score.team_card_points[0] ?? 0) > (score.team_card_points[1] ?? 0)
      ? 0
      : (score.team_card_points[1] ?? 0) > (score.team_card_points[0] ?? 0)
        ? 1
        : null;
  return (
    <div className="rounded border border-stone-200 px-4 py-3 space-y-1">
      <div className="flex gap-4 font-medium">
        <span>
          Team 0 (Sitz 0+2): <strong>{score.team_card_points[0] ?? 0}</strong>
        </span>
        <span>
          Team 1 (Sitz 1+3): <strong>{score.team_card_points[1] ?? 0}</strong>
        </span>
      </div>
      <p className="text-sm text-stone-500">
        Summe: {sum} {score.matsch_team !== null && <> · Matsch für Team {score.matsch_team}!</>}
        {winner !== null && <> · Sieg: Team {winner}</>}
      </p>
    </div>
  );
}

function RematchStatus({ vote, outcome }: { vote: "YES" | "NO"; outcome: RematchOutcome | null }) {
  if (!outcome) return null;
  if (outcome.kind === "pending") {
    return (
      <div className="rounded bg-stone-100 px-3 py-2 text-sm">
        Du hast „{vote === "YES" ? "ja" : "nein"}" gewählt. Warten auf {outcome.remainingVotes}{" "}
        {outcome.remainingVotes === 1 ? "weiteren Spieler" : "weitere Spieler"} …
      </div>
    );
  }
  if (outcome.kind === "rematch-started") {
    return (
      <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">
        Alle dabei — neue Runde startet. (Tisch wechselt automatisch zum neuen Game.)
      </div>
    );
  }
  return (
    <div className="rounded bg-violet-50 border border-violet-200 px-3 py-2 text-sm text-violet-900">
      Nicht alle wollen weiterspielen. Der Tisch geht zurück in die Warte-Phase.
    </div>
  );
}
