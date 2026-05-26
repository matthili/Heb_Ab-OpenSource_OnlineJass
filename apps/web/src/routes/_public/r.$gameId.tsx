/**
 * Öffentliche Replay-Share-URL.
 *
 * Funktioniert ohne Login. Lädt `/api/games/:id/replay/public`, das 404
 * liefert, solange der Teilnehmer das Replay nicht über den Toggle im
 * eingeloggten Bereich auf „öffentlich" gestellt hat.
 *
 * Bewusst unter `_public/r.$gameId.tsx` (kurze URL `/r/<id>` zum Teilen),
 * getrennt vom eingeloggten `/replay/:gameId` (das auch laufende Spiele
 * + Owner-Toggle unterstützt).
 */
import { createFileRoute, Link } from "@tanstack/react-router";

import { ReplayPlayer } from "~/features/replay/ReplayPlayer";
import { usePublicReplay } from "~/features/replay/useReplay";

export const Route = createFileRoute("/_public/r/$gameId")({
  component: PublicReplayPage,
});

function PublicReplayPage() {
  const { gameId } = Route.useParams();
  const { data, isLoading, error } = usePublicReplay(gameId);

  if (isLoading) {
    return <p className="text-stone-500">Replay wird geladen…</p>;
  }
  if (error) {
    return (
      <section className="space-y-3 max-w-xl">
        <h1 className="text-2xl font-bold">Replay nicht öffentlich</h1>
        <p className="text-stone-700">
          Dieses Replay existiert entweder nicht, oder die Teilnehmer haben es noch nicht zum Teilen
          freigegeben.
        </p>
        <p>
          <Link to="/login" className="text-sm text-stone-600 underline">
            Einloggen, um eigene Replays zu sehen
          </Link>
        </p>
      </section>
    );
  }
  if (!data) {
    return <p className="text-stone-500">Kein Replay-Bundle empfangen.</p>;
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold">Replay (geteilt)</h1>
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
        <ReplayPlayer bundle={data.bundle} frames={data.frames} mySeat={0} />
      ) : (
        <p className="text-stone-500">Keine abspielbaren Frames.</p>
      )}
    </section>
  );
}
