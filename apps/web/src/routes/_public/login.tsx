/**
 * Login-Form.
 *
 * Akzeptiert einen optionalen `?redirect=…`-Query-Param: wenn der User
 * vor dem Login z.B. `/lobby` aufgerufen hat, wird er nach erfolgreichem
 * Sign-In direkt dorthin geleitet (gesetzt vom `_auth`-Guard).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { signIn } from "~/lib/auth-client";

const LoginSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/_public/login")({
  validateSearch: LoginSearchSchema,
  component: LoginPage,
});

function LoginPage() {
  // navigate aus useNavigate ist hier nicht nötig — wir benutzen direkt
  // window.location.href, weil der `redirect`-Wert auch eine vollständige
  // URL sein kann (kommt vom `_auth`-Guard via location.href).
  const { t } = useTranslation();
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? t("auth.login.failed"));
        return;
      }
      const target = search.redirect ?? "/lobby";
      window.location.href = target;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.login.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <img
        src="/logo/lockup-gestapelt-hell.svg"
        alt={t("appName")}
        className="mx-auto h-32 w-auto"
      />
      <h1 className="text-2xl font-bold">{t("auth.login.title")}</h1>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <Field label={t("auth.login.emailLabel")} htmlFor="email">
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
        <Field label={t("auth.login.passwordLabel")} htmlFor="password">
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            name="password"
            autoComplete="current-password"
          />
        </Field>

        {error && (
          <div
            role="alert"
            className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
          >
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-jass-primary w-full">
          {loading ? t("auth.login.submitting") : t("auth.login.submit")}
        </button>
      </form>
      <p className="text-sm text-stone-600">
        {t("auth.login.noAccount")}{" "}
        <Link to="/register" className="text-stone-900 underline">
          {t("nav.signUp")}
        </Link>
      </p>
      <p className="text-sm">
        <Link to="/forgot-password" className="text-stone-700 underline">
          {t("auth.login.forgotPassword")}
        </Link>
      </p>
      {search.redirect && (
        <p className="text-xs text-stone-500">
          {t("auth.login.redirectHint", { target: search.redirect })}
        </p>
      )}
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
