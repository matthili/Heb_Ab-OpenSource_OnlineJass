/**
 * Reset-Password — Klick-Ziel des Mail-Links.
 *
 * Better Auth liefert den Token in `?token=…` mit. Bei Submit ruft der
 * Client `authClient.resetPassword({ newPassword, token })`. Bei Erfolg
 * → Login-Seite mit Hinweis.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { authClient } from "~/lib/auth-client";

const ResetSearch = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/_public/reset-password")({
  validateSearch: ResetSearch,
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useTranslation();
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">{t("auth.reset.title")}</h1>
        <p role="alert" className="text-sm text-rose-700">
          {t("auth.reset.invalidToken")}
        </p>
        <p className="text-sm">
          <Link to="/forgot-password" className="text-stone-900 underline">
            {t("auth.login.forgotPassword")}
          </Link>
        </p>
      </section>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError(t("auth.register.passwordTooShort"));
      return;
    }
    setLoading(true);
    try {
      const res = await authClient.resetPassword({ newPassword: password, token });
      if (res.error) {
        setError(res.error.message ?? t("auth.reset.invalidToken"));
        return;
      }
      // Erfolg → Login mit Verified-Indikator wäre falsch (das ist nur für
      // Email-Verify). Wir leiten direkt zum Login und zeigen den
      // Success-Toast eine Sekunde lang per Query-Param.
      void navigate({ to: "/login" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.reset.invalidToken"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t("auth.reset.title")}</h1>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <label htmlFor="new-password" className="block">
          <span className="block text-sm font-medium text-stone-700 mb-1">
            {t("auth.reset.passwordLabel")}
          </span>
          <input
            id="new-password"
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            autoComplete="new-password"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-jass-primary w-full">
          {loading ? t("auth.reset.submitting") : t("auth.reset.submit")}
        </button>
      </form>
    </section>
  );
}
