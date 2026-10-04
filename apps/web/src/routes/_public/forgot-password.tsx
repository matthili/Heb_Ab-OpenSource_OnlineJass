/**
 * Passwort-Reset anstoßen.
 *
 * Better-Auth-Endpoint: `POST /api/auth/request-password-reset` — über den
 * typisierten Client `authClient.requestPasswordReset`. Früher riefen wir
 * `/forget-password` von Hand auf; den gibt es in Better Auth 1.6 nicht mehr,
 * und weil die Antwort ignoriert wurde, lief das Formular still ins Leere.
 * Mit dem Client fällt eine künftige Umbenennung beim Typecheck auf.
 *
 * **User-Enumeration-Schutz liegt beim Server:** Better Auth antwortet für
 * registrierte und unbekannte Adressen identisch. Echte Fehler (Captcha,
 * Rate-Limit, Server weg) zeigen wir deshalb an — sie hängen nicht davon ab,
 * ob die Adresse existiert.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { TurnstileWidget } from "~/features/auth/TurnstileWidget";
import { appHref } from "~/lib/app-path";
import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/_public/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [resetCounter, setResetCounter] = useState(0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!captchaToken) {
      setError(t("auth.captchaPending"));
      return;
    }
    setLoading(true);
    try {
      const res = await authClient.requestPasswordReset(
        {
          email,
          // Reset-Link führt zur `/reset-password`-Route mit dem token im
          // Query-Param. appHref stellt den SPA-Basepath (/app in Prod) voran,
          // sonst zeigt der Mail-Link auf die Origin-Wurzel (= Landing, ohne
          // Reset-Formular).
          redirectTo: `${window.location.origin}${appHref("/reset-password")}`,
        },
        { headers: { "X-Turnstile-Token": captchaToken } }
      );
      if (res.error) {
        // Better Auths 429-Text ist englisch — eigene Meldung statt Rohtext.
        setError(
          res.error.status === 429
            ? t("auth.forgot.tooManyRequests")
            : (res.error.message ?? t("auth.forgot.genericError"))
        );
        // Token verbrannt — frisches Widget rendern.
        setCaptchaToken(null);
        setResetCounter((n) => n + 1);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.forgot.genericError"));
      setCaptchaToken(null);
      setResetCounter((n) => n + 1);
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
        <TurnstileWidget
          key={resetCounter}
          action="forgot-password"
          onToken={(token) => setCaptchaToken(token)}
        />
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || !captchaToken}
          className="btn-jass-primary w-full"
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
