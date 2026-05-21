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

import type { RematchOutcome } from "~/features/game/types";
import { api, ApiError } from "~/lib/api";

const AUTO_YES_SECONDS = 10;

export function BodenseeRematchPanel({ gameId }: { gameId: string }) {
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
      setError(err instanceof ApiError ? err.message : "Vote fehlgeschlagen.");
    },
  });

  // Sendet den Vote genau einmal — egal wie oft aufgerufen.
  const castVote = useCallback(
    (vote: "YES" | "NO") => {
      if (votedRef.current) return;
      votedRef.current = true;
      voteMut.mutate(vote);
    },
    [voteMut]
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
    <section className="space-y-3 rounded-lg border border-jass-paperEdge bg-jass-cream p-4 shadow-sm">
      {!myVote ? (
        <div className="space-y-2">
          <p className="font-medium text-jass-ink">Nochmal spielen?</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => castVote("YES")}
              disabled={voteMut.isPending}
              className="btn-jass-primary text-base"
            >
              ▶ Weiter
            </button>
            <button
              type="button"
              onClick={() => castVote("NO")}
              disabled={voteMut.isPending}
              className="text-sm text-jass-inkSoft underline hover:text-jass-ink disabled:opacity-50"
            >
              Aufhören
            </button>
            <span className="ml-auto text-xs tabular-nums text-jass-inkSoft">
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

function RematchStatus({ vote, outcome }: { vote: "YES" | "NO"; outcome: RematchOutcome | null }) {
  if (!outcome) return null;
  if (outcome.kind === "pending") {
    return (
      <div className="rounded border border-jass-paperEdge bg-jass-paper px-3 py-2 text-sm text-jass-ink">
        Du hast „{vote === "YES" ? "weiter" : "aufhören"}" gewählt. Warten auf{" "}
        {outcome.remainingVotes}{" "}
        {outcome.remainingVotes === 1 ? "weiteren Spieler" : "weitere Spieler"} …
      </div>
    );
  }
  if (outcome.kind === "rematch-started") {
    return (
      <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        Nächste Runde startet. (Tisch wechselt automatisch zum neuen Game.)
      </div>
    );
  }
  return (
    <div className="rounded border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
      Nicht alle wollen weiterspielen. Der Tisch geht zurück in die Warte-Phase.
    </div>
  );
}
