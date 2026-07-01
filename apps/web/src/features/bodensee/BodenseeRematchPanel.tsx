/**
 * Re-Match-Vote-Panel für Bodensee-Jass.
 *
 * Bewusst schlank: der Endstand wird bereits vom `FinishedPanel` in der
 * `BodenseeBoard` angezeigt — dieses Panel liefert nur die Abstimmung
 * („Weiter spielen?"). Großer „Weiter"-Button (= YES), dezentes
 * „Aufhören" (= NO), 10-Sekunden-Auto-YES.
 *
 * Vote geht an `POST /api/games/:id/rematch-vote` (derselbe Endpoint wie
 * Kreuz/Solo). Bei All-YES startet das Backend über `BodenseeGameService`
 * ein frisches Spiel; der Tisch-State-Push wechselt die UI zum neuen Game.
 *
 * **Einmal-Guard** (`votedRef`): Der Auto-YES-Effekt kann mehrfach
 * durchlaufen (React re-rendert das Mutation-Objekt). Ohne Guard würden
 * zwei Votes quasi-gleichzeitig rausgehen — der zweite läuft serverseitig
 * in einen Unique-Constraint und liefert einen 500er. `castVote` sendet
 * darum garantiert nur einmal.
 */
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { RematchOutcome } from "~/features/game/types";
import { api, ApiError } from "~/lib/api";

const AUTO_YES_SECONDS = 10;

export function BodenseeRematchPanel({ gameId }: { gameId: string }) {
  const { t } = useTranslation();
  const [myVote, setMyVote] = useState<"YES" | "NO" | null>(null);
  const [outcome, setOutcome] = useState<RematchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_YES_SECONDS);
  const votedRef = useRef(false);

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
      setError(err instanceof ApiError ? err.message : t("rematch.voteFailed"));
    },
  });

  // Sendet den Vote genau einmal — egal wie oft aufgerufen. Abhängigkeit ist
  // bewusst `voteMut.mutate` (referenz-STABIL über Re-Renders), NICHT `voteMut`
  // (das `useMutation`-Objekt ist bei jedem Render neu). Sonst änderte sich
  // `castVote` ständig, der Countdown-Effekt liefe bei jedem Render neu und sein
  // `setTimeout` würde vor Ablauf immer wieder zurückgesetzt → Auto-YES feuert
  // nie → der Re-Match hängt (genau dieser Bug).
  const mutate = voteMut.mutate;
  const castVote = useCallback(
    (vote: "YES" | "NO") => {
      if (votedRef.current) return;
      votedRef.current = true;
      mutate(vote);
    },
    [mutate]
  );

  // Auto-YES-Countdown — läuft, solange noch nicht gevotet wurde.
  useEffect(() => {
    if (myVote !== null) return;
    if (secondsLeft <= 0) {
      castVote("YES");
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, myVote, castVote]);

  return (
    <section className="space-y-3 rounded-jass border border-jass-paperEdge bg-jass-cream p-4 panel-jass">
      {!myVote ? (
        <div className="space-y-2">
          <p className="font-medium text-jass-ink">{t("bodensee.rematch.playAgain")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => castVote("YES")}
              disabled={voteMut.isPending}
              className="btn-jass-primary text-base"
            >
              {t("rematch.continue")}
            </button>
            <button
              type="button"
              onClick={() => castVote("NO")}
              disabled={voteMut.isPending}
              className="text-sm text-jass-inkSoft underline hover:text-jass-ink disabled:opacity-50"
            >
              {t("rematch.stop")}
            </button>
            <span className="ml-auto text-xs tabular-nums text-jass-inkSoft">
              <Trans
                i18nKey="rematch.autoStart"
                values={{ seconds: secondsLeft }}
                components={{ strong: <strong /> }}
              />
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

function RematchStatus({ vote, outcome }: { vote: "YES" | "NO"; outcome: RematchOutcome | null }) {
  const { t } = useTranslation();
  if (!outcome) return null;
  if (outcome.kind === "pending") {
    return (
      <div className="rounded border border-jass-paperEdge bg-jass-paper px-3 py-2 text-sm text-jass-ink">
        {t("rematch.status.pending", {
          vote: vote === "YES" ? t("rematch.status.votedYes") : t("rematch.status.votedNo"),
          count: outcome.remainingVotes,
          players:
            outcome.remainingVotes === 1
              ? t("rematch.status.playerOne")
              : t("rematch.status.playerOther"),
        })}
      </div>
    );
  }
  if (outcome.kind === "rematch-started") {
    return (
      <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        {t("rematch.status.started")}
      </div>
    );
  }
  return (
    <div className="rounded border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
      {t("rematch.status.declined")}
    </div>
  );
}
