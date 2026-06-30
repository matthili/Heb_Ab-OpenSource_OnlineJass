/**
 * Index-Route: zeigt eine kompakte Willkommens-Seite mit Buttons.
 * Eingeloggte User werden direkt in die Lobby umgeleitet.
 *
 * Der optionale Query-Param `?verified=1` (vom Verify-Mail-Callback)
 * triggert eine Erfolgs-Meldung — sonst wäre nicht klar, ob der Klick
 * was bewirkt hat.
 */
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { verified } = Route.useSearch();
  return (
    <section className="space-y-6">
      {verified && (
        <div
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {t("home.verified")}
        </div>
      )}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{t("appName")}</h1>
        <p className="text-stone-600">{t("appTagline")}</p>
      </div>
      <p>{t("home.body")}</p>
      <div className="flex gap-3">
        <Link to="/login" className="btn-jass-primary">
          {t("home.ctaSignIn")}
        </Link>
        <Link to="/register" className="btn-jass-secondary">
          {t("home.ctaSignUp")}
        </Link>
      </div>
    </section>
  );
}
