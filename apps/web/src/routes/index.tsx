/**
 * Index-Route: zeigt eine kompakte Willkommens-Seite mit Buttons.
 * Eingeloggte User werden direkt in die Lobby umgeleitet.
 *
 * Der optionale Query-Param `?verified=1` (vom Verify-Mail-Callback)
 * triggert eine Erfolgs-Meldung — sonst wäre nicht klar, ob der Klick
 * was bewirkt hat.
 */
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { authClient } from "~/lib/auth-client";

const IndexSearch = z.object({
  verified: z.union([z.literal("1"), z.literal(1)]).optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: IndexSearch,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session.data?.user) {
      throw redirect({ to: "/lobby" });
    }
  },
  component: HomePage,
});

function HomePage() {
  const { verified } = Route.useSearch();
  return (
    <section className="space-y-6">
      {verified && (
        <div
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          E-Mail bestätigt. Du kannst dich jetzt anmelden.
        </div>
      )}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Heb ab!</h1>
        <p className="text-stone-600">Der OpenSource-Jass nach vorarlberger Spielart.</p>
      </div>
      <p>
        Spiel Vorarlberger Kreuz-Jass gegen echte Menschen oder KI-Gegner — auf deinem eigenen
        Server, ohne Werbung, ohne Tracking.
      </p>
      <div className="flex gap-3">
        <Link to="/login" className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700">
          Anmelden
        </Link>
        <Link
          to="/register"
          className="rounded border border-stone-300 px-4 py-2 text-stone-900 hover:bg-stone-100"
        >
          Konto anlegen
        </Link>
      </div>
    </section>
  );
}
