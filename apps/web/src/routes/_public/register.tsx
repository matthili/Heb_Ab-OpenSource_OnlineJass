/**
 * Registrierungs-Form.
 *
 * Validierung wird primär vom Server (Better Auth + Zod) gemacht — der
 * Client zeigt Server-Fehler 1:1 an und hat nur minimale Vor-Checks
 * (Passwort-Länge ≥ 12, weil das auch die Server-Regel ist).
 *
 * Nach erfolgreichem Sign-Up: Weiterleitung auf `/check-email`. Better
 * Auth schickt die Verify-Mail asynchron im Hintergrund.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { TurnstileWidget } from "~/features/auth/TurnstileWidget";
import { signUp } from "~/lib/auth-client";

export const Route = createFileRoute("/_public/register")({
  component: RegisterPage,
});

function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Inkrementeller Reset-Schlüssel — bei einem fehlgeschlagenen Submit
  // verbrennen wir das alte Token (Cloudflare lässt es nicht zweimal
  // einlösen) und re-mounten das Widget mit `key={resetCounter}`.
  const [resetCounter, setResetCounter] = useState(0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError(t("auth.register.passwordTooShort"));
      return;
    }
    if (!captchaToken) {
      setError(t("auth.captchaPending"));
      return;
    }
    setLoading(true);
    try {
      const res = await signUp.email(
        {
          email,
          password,
          name,
          callbackURL: `${window.location.origin}/?verified=1`,
        },
        {
          headers: { "X-Turnstile-Token": captchaToken },
        }
      );
      if (res.error) {
        setError(res.error.message ?? t("auth.register.failed"));
        // Token verbrannt — frisches Widget rendern.
        setCaptchaToken(null);
        setResetCounter((n) => n + 1);
        return;
      }
      await navigate({ to: "/check-email", search: { email } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.register.failed"));
      setCaptchaToken(null);
      setResetCounter((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t("auth.register.title")}</h1>
      <p className="text-sm text-stone-600">{t("auth.register.intro")}</p>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <Field label={t("auth.register.nameLabel")} htmlFor="name">
          <input
            id="name"
            type="text"
            required
            minLength={3}
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            name="nickname"
            autoComplete="nickname"
          />
        </Field>
        <Field label={t("auth.register.emailLabel")} htmlFor="email">
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            name="email"
            autoComplete="username"
          />
        </Field>
        <Field label={t("auth.register.passwordLabel")} htmlFor="password">
          <input
            id="password"
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            name="password"
            autoComplete="new-password"
          />
        </Field>

        <TurnstileWidget
          key={resetCounter}
          action="register"
          onToken={(token) => setCaptchaToken(token)}
        />

        {/*
          Anti-User-Enumeration-Hinweis: Better Auth verschluckt bewusst
          den „diese Mail existiert schon"-Fehler (verhindert, dass jemand
          per Brute-Force prüfen kann, welche Adressen registriert sind).
          UX-Folge: User, die zweimal Sign-up klicken, bekommen keinen
          Fehler — aber auch keine zweite Verify-Mail. Dieser Hinweis
          fängt das ab, *bevor* sie überhaupt klicken.
        */}
        <p className="text-xs text-stone-600 bg-jass-cream border border-jass-paperEdge rounded px-3 py-2 leading-snug">
          <Trans
            i18nKey="auth.register.existingEmailHint"
            components={{
              strong: <strong />,
              a: <Link to="/forgot-password" className="underline font-medium" />,
            }}
          />
        </p>

        {error && (
          <div
            role="alert"
            className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !captchaToken}
          className="btn-jass-primary w-full"
        >
          {loading ? t("auth.register.submitting") : t("auth.register.submit")}
        </button>
      </form>
      <p className="text-sm text-stone-600">
        {t("auth.register.alreadyHave")}{" "}
        <Link to="/login" className="text-stone-900 underline">
          {t("nav.signIn")}
        </Link>
      </p>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="block text-sm font-medium text-stone-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
