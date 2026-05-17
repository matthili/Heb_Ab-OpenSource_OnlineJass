/**
 * Stand-Index — der Health-Check der Spiel-SPA. M7-B ersetzt das durch
 * die echte Login-/Lobby-Weiche.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-bold">Heb ab! — Vorarlberger Kreuz-Jass</h1>
      <p className="text-stone-600">
        Frontend-Skelett ist aktiv (Vite 8, React 19, TanStack Router/Query, Tailwind 4). Auth- und
        Lobby-Flows folgen mit M7-B.
      </p>
      <p className="text-sm text-stone-500">
        API-Health: <code className="rounded bg-stone-100 px-1.5">/api/health</code>
      </p>
    </section>
  );
}
