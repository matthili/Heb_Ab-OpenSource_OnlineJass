/**
 * Re-Match-Vote-Panel — zeigt nach Spielende den Final-Score und einen
 * prominenten „Weiter spielen"-Button.
 *
 * **Flow** (User-Spec aus Demo-Feedback):
 *   - Großer „Weiter spielen"-Button als Hauptaktion (= YES vote).
 *   - Daneben dezent „Aufhören" (= NO vote, Tisch geht zurück nach WAITING).
 *   - **10-Sekunden-Auto-YES**: wenn der User innerhalb 10 s nicht klickt,
 *     wird YES automatisch ausgelöst. So muss niemand klicken, wenn er
 *     ohnehin weitermachen möchte (häufiger Fall) — Aufhören ist die
 *     bewusste Aktion.
 *   - Countdown sichtbar als kleine Sekundenzahl unter dem Button.
 *   - Nach dem Vote: Status-Anzeige (wartet auf Mitspieler / Rematch
 *     startet / zurück zur Lobby).
 *
 * Outcome-Events kommen via WS (`game:rematch-decided`) — die werden im
 * Eltern-Component (TableDetail) gehandhabt. Hier ist nur die Anzeige
 * + Vote-API-Call + Countdown-Logik.
 */
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, ApiError } from "~/lib/api";
import type { FinalScore, RematchOutcome } from "./types";

const AUTO_YES_SECONDS = 10;

interface Props {
  gameId: string;
  finalScore: FinalScore | undefined;
  /** Kumulativer Partie-Stand Team 0 — optional, für Kontext-Anzeige. */
  cumulativeScoreTeam0?: number;
  cumulativeScoreTeam1?: number;
  /** Punkteziel der Partie (z.B. 1000). */
  targetScore?: number;
}

export function RematchPanel({
  gameId,
  finalScore,
  cumulativeScoreTeam0,
  cumulativeScoreTeam1,
  targetScore,
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
  // Bei 0 → automatisch YES auslösen.
  useEffect(() => {
    if (myVote !== null) return;
    if (secondsLeft <= 0) {
      voteMut.mutate("YES");
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, myVote, voteMut]);

  return (
    <section className="space-y-4 rounded-lg border border-jass-paperEdge bg-jass-cream p-4 shadow-sm">
      <h2 className="text-xl font-bold text-jass-ink">Spiel beendet</h2>

      {finalScore && <FinalScoreView score={finalScore} />}

      {/*
        Kontextueller Partie-Stand: zeigt den kumulativen Score gegen
        das Punkteziel. Hilft dem User zu verstehen, ob die Partie schon
        knapp wird oder noch lange dauert.
      */}
      {targetScore !== undefined &&
        cumulativeScoreTeam0 !== undefined &&
        cumulativeScoreTeam1 !== undefined && (
          <MatchProgress
            team0={cumulativeScoreTeam0}
            team1={cumulativeScoreTeam1}
            target={targetScore}
          />
        )}

      {!myVote ? (
        <div className="space-y-2">
          {/* Texte bewusst kontextabhängig:
                – POST_GAME (= Ziel nicht erreicht, Partie geht weiter):
                  „Bereit für die nächste Runde?" — neutrale Fortsetzungs-
                  Frage, keine „Lust auf nochmal"-Konnotation.
                – Das Panel rendert OHNEHIN nur in POST_GAME; Partie-Ende
                  läuft via OwnerPanel + new-match-Endpoint. */}
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

function FinalScoreView({ score }: { score: FinalScore }) {
  const sum = score.team_card_points.reduce((a, b) => a + b, 0);
  const winner =
    (score.team_card_points[0] ?? 0) > (score.team_card_points[1] ?? 0)
      ? 0
      : (score.team_card_points[1] ?? 0) > (score.team_card_points[0] ?? 0)
        ? 1
        : null;
  return (
    <div className="rounded border border-jass-paperEdge bg-jass-paper px-4 py-3 space-y-1">
      <div className="flex gap-4 font-medium text-jass-ink">
        <span>
          Team 0 (Sitz 0+2): <strong>{score.team_card_points[0] ?? 0}</strong>
        </span>
        <span>
          Team 1 (Sitz 1+3): <strong>{score.team_card_points[1] ?? 0}</strong>
        </span>
      </div>
      <p className="text-sm text-jass-inkSoft">
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
 * Partie-Fortschritt-Anzeige: kumulative Scores beider Teams + Ziel.
 * Hebt visuell hervor, welches Team näher dran ist und wie viele Punkte
 * fehlen.
 */
function MatchProgress({ team0, team1, target }: { team0: number; team1: number; target: number }) {
  const leader = team0 > team1 ? 0 : team1 > team0 ? 1 : null;
  const closest = Math.max(team0, team1);
  const remaining = Math.max(0, target - closest);
  return (
    <div className="rounded border border-jass-paperEdge bg-jass-paper px-4 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs uppercase tracking-wide text-jass-inkSoft">Partie-Stand</span>
        <span className={leader === 0 ? "font-bold text-jass-ink" : "text-jass-inkSoft"}>
          Team 0: {team0}
        </span>
        <span className={leader === 1 ? "font-bold text-jass-ink" : "text-jass-inkSoft"}>
          Team 1: {team1}
        </span>
        <span className="ml-auto text-xs text-jass-inkSoft">
          Ziel: <strong className="text-jass-ink">{target}</strong>
          {remaining > 0 && <> · noch {remaining} Punkte</>}
        </span>
      </div>
    </div>
  );
}
