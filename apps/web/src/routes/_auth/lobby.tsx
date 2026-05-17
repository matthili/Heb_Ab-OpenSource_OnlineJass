/**
 * Lobby-Stub für M7-B. Die echte Lobby-View mit Tisch-Liste, Beitritt
 * und WS-Live-Updates entsteht in M7-C.
 */
import { createFileRoute } from "@tanstack/react-router";

import { useSession } from "~/lib/auth-client";

export const Route = createFileRoute("/_auth/lobby")({
  component: LobbyPage,
});

function LobbyPage() {
  const { data } = useSession();
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Lobby</h1>
      <p className="text-stone-600">
        Servus <strong>{data?.user?.name}</strong> — die richtige Lobby-Übersicht mit Tisch- Liste
        und Live-Updates kommt mit M7-C.
      </p>
      <p className="text-sm text-stone-500">
        Backend ist schon da:{" "}
        <code className="rounded bg-stone-100 px-1.5">GET /api/lobby/tables</code>,{" "}
        <code className="rounded bg-stone-100 px-1.5">POST /api/lobby/tables</code>, WS-Pushes via{" "}
        <code className="rounded bg-stone-100 px-1.5">lobby:tables-updated</code>.
      </p>
    </section>
  );
}
