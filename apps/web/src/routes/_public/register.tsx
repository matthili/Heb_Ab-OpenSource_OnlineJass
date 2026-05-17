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

import { signUp } from "~/lib/auth-client";

export const Route = createFileRoute("/_public/register")({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Das Passwort muss mindestens 12 Zeichen lang sein.");
      return;
    }
    setLoading(true);
    try {
      const res = await signUp.email({
        email,
        password,
        name,
        // Nach Klick auf den Verify-Link kommt der User hier raus —
        // `?verified=1` triggert in der Home-Route eine Erfolgs-Meldung.
        callbackURL: `${window.location.origin}/?verified=1`,
      });
      if (res.error) {
        setError(res.error.message ?? "Registrierung fehlgeschlagen.");
        return;
      }
      await navigate({ to: "/check-email", search: { email } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Registrieren</h1>
      <p className="text-sm text-stone-600">
        Mit der Registrierung legst du einen Spielernamen + ein Passwort an. Du bekommst eine
        Bestätigungs-Mail.
      </p>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <Field label="Spielername" htmlFor="name">
          <input
            id="name"
            type="text"
            required
            minLength={3}
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            autoComplete="username"
          />
        </Field>
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
        <Field label="Passwort (≥ 12 Zeichen)" htmlFor="password">
          <input
            id="password"
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            autoComplete="new-password"
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
          {loading ? "Wird angelegt…" : "Konto anlegen"}
        </button>
      </form>
      <p className="text-sm text-stone-600">
        Schon ein Konto?{" "}
        <Link to="/login" className="text-stone-900 underline">
          Anmelden
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
