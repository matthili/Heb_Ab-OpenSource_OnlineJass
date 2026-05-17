/**
 * Login-Form.
 *
 * Akzeptiert einen optionalen `?redirect=…`-Query-Param: wenn der User
 * vor dem Login z.B. `/lobby` aufgerufen hat, wird er nach erfolgreichem
 * Sign-In direkt dorthin geleitet (gesetzt vom `_auth`-Guard).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
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
        // Better Auth liefert je nach Fall andere Codes. Wir zeigen die
        // Server-Message direkt — sie ist generisch genug („Invalid email
        // or password" / „Please verify your email first").
        setError(res.error.message ?? "Anmeldung fehlgeschlagen.");
        return;
      }
      // Erfolg → entweder zurück zur ursprünglichen URL oder in die Lobby.
      const target = search.redirect ?? "/lobby";
      // `navigate` mit dynamischem to-Wert braucht die `unsafeRelative`-
      // Option in TanStack Router; einfacher: window.location.href.
      window.location.href = target;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Anmelden</h1>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <Field label="E-Mail" htmlFor="email">
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            autoComplete="email"
          />
        </Field>
        <Field label="Passwort" htmlFor="password">
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
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

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {loading ? "Wird angemeldet…" : "Anmelden"}
        </button>
      </form>
      <p className="text-sm text-stone-600">
        Noch kein Konto?{" "}
        <Link to="/register" className="text-stone-900 underline">
          Registrieren
        </Link>
      </p>
      <p className="text-xs text-stone-400">
        {/* Reset-Flow gibt's in der API schon (POST /api/auth/forget-password) — der UI-Knopf
           kommt mit M7-F, weil M7-B noch keine Mail-Template-Polish hat. */}
        Passwort vergessen? (Reset-Flow folgt mit M7-F)
      </p>
      {search.redirect && (
        <p className="text-xs text-stone-500">
          Nach der Anmeldung geht's zurück zu <code>{search.redirect}</code>.
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
