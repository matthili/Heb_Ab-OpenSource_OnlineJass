/**
 * Replay-Route: zeigt ein abgespeichertes Spiel Schritt für Schritt.
 *
 * Sichtbar nur für eingeloggte User; die API liefert das Bundle nur an
 * Teilnehmer (oder Admins). Andere User bekommen 403 → wir rendern
 * eine freundliche Fehlermeldung statt rohem JSON.
 */
import { createFileRoute, Link } from "@tanstack/react-router";

import { ReplayPlayer } from "~/features/replay/ReplayPlayer";
import { useReplay } from "~/features/replay/useReplay";
import { useSession } from "~/lib/auth-client";

export const Route = createFileRoute("/_auth/replay/$gameId")({
  component: ReplayPage,
});

function ReplayPage() {
  const { gameId } = Route.useParams();
  const { data: session } = useSession();
  const { data, isLoading, error } = useReplay(gameId);

  if (isLoading) {
    return <p className="text-stone-500">Replay wird geladen…</p>;
  }
  if (error) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-bold">Replay nicht verfügbar</h1>
        <p className="text-stone-700">
          {error instanceof Error ? error.message : "Unbekannter Fehler."}
        </p>
        <p>
          <Link to="/lobby" className="text-sm text-stone-600 underline">
            Zurück zur Lobby
          </Link>
        </p>
      </section>
    );
  }
  if (!data) {
    return <p className="text-stone-500">Kein Replay-Bundle empfangen.</p>;
  }

  // Eigenen Sitz finden, sonst Sitz 0 als Default (Admin-View).
  const mySeat = session?.user?.id
    ? (data.bundle.seats.find((s) => s.userId === session.user.id)?.seat ?? 0)
    : 0;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold">Replay</h1>
        <span className="text-sm text-stone-600">
          {new Date(data.bundle.startedAt).toLocaleString("de-AT")}
          {data.bundle.endedAt
            ? ` – ${new Date(data.bundle.endedAt).toLocaleTimeString("de-AT")}`
            : " (läuft noch)"}
        </span>
        <span className="text-xs rounded bg-stone-100 px-2 py-0.5 text-stone-700">
          Spec {data.bundle.ruleVersion}
          {data.bundle.modelVersion ? ` · Modell ${data.bundle.modelVersion}` : ""}
        </span>
        <Link to="/lobby" className="ml-auto text-sm text-stone-600 underline">
          Zurück zur Lobby
        </Link>
      </header>

      {data.error && (
        <div
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {data.error}
        </div>
      )}

      {data.frames.length > 0 ? (
        <ReplayPlayer bundle={data.bundle} frames={data.frames} mySeat={mySeat} />
      ) : (
        <p className="text-stone-500">Keine abspielbaren Frames.</p>
      )}

      {data.bundle.finalScore && (
        <FinalScoreCard
          finalScore={data.bundle.finalScore}
          seats={data.bundle.seats}
          mySeat={mySeat}
        />
      )}
    </section>
  );
}

function FinalScoreCard({
  finalScore,
  seats,
  mySeat,
}: {
  finalScore: { team_card_points: number[]; matsch_team: number | null };
  seats: { seat: number; displayName: string | null; aiSeatType: string | null }[];
  mySeat: number;
}) {
  const myTeam = mySeat % 2;
  const teams: [number, number] = [
    finalScore.team_card_points[0] ?? 0,
    finalScore.team_card_points[1] ?? 0,
  ];
  const seatsInTeam = (team: number): string =>
    seats
      .filter((s) => s.seat % 2 === team)
      .map((s) => s.displayName ?? (s.aiSeatType ? `KI` : `Sitz ${s.seat}`))
      .join(" + ");

  return (
    <div className="rounded border border-stone-200 bg-white p-4">
      <h2 className="text-lg font-semibold mb-2">Endstand</h2>
      <table className="text-sm w-full">
        <tbody>
          {[0, 1].map((t) => (
            <tr key={t} className={t === myTeam ? "font-medium" : ""}>
              <td className="py-1 pr-2">
                Team {t} ({seatsInTeam(t)})
              </td>
              <td className="py-1 text-right tabular-nums">{teams[t]}</td>
              <td className="py-1 pl-2">{finalScore.matsch_team === t ? "Matsch!" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
