/**
 * Passwort-Reset anstoßen.
 *
 * Better-Auth-Endpoint: `POST /api/auth/forget-password` (siehe
 * https://better-auth.com/docs/authentication/email-password#forget-password).
 * Wir geben dem Server immer dieselbe Erfolgs-Meldung zurück, unabhängig
 * davon, ob die E-Mail registriert war — sonst wäre das ein
 * User-Enumeration-Vektor.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "~/lib/api";

export const Route = createFileRoute("/_public/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Better-Auth's React-Client exposed `forgetPassword` nicht direkt;
      // wir rufen den Endpoint manuell. Antwort ignorieren — wir zeigen
      // immer „Mail ist unterwegs", egal ob die E-Mail registriert war
      // (User-Enumeration-Schutz).
      await api("/api/auth/forget-password", {
        method: "POST",
        body: {
          email,
          // Reset-Link führt zur `/reset-password`-Route mit dem token im
          // Query-Param.
          redirectTo: `${window.location.origin}/reset-password`,
        },
      }).catch(() => {
        /* Server-Fehler still durchgehen lassen — siehe oben */
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <section className="space-y-4 text-center py-8">
        <div className="text-5xl" aria-hidden="true">
          ✉️
        </div>
        <h1 className="text-2xl font-bold">{t("auth.forgot.title")}</h1>
        <p className="text-stone-600">{t("auth.forgot.sent")}</p>
        <p className="text-sm">
          <Link to="/login" className="text-stone-900 underline">
            {t("auth.checkEmail.back")}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t("auth.forgot.title")}</h1>
      <p className="text-sm text-stone-600">{t("auth.forgot.intro")}</p>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <label htmlFor="email" className="block">
          <span className="block text-sm font-medium text-stone-700 mb-1">
            {t("auth.forgot.emailLabel")}
          </span>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            autoComplete="email"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {loading ? t("auth.forgot.submitting") : t("auth.forgot.submit")}
        </button>
      </form>
      <p className="text-sm">
        <Link to="/login" className="text-stone-900 underline">
          {t("auth.checkEmail.back")}
        </Link>
      </p>
    </section>
  );
}
