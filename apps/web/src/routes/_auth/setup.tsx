/**
 * Erstanmeldungs-Setup. Pflicht-Felder: Vorname + Nachname. Solange beide
 * leer sind, blockt der `_auth`-Guard alle anderen Routen — der User
 * muss hier durch.
 *
 * Bewusst minimal: kein Visibility-Selector, keine optionalen Felder.
 * Wer mehr will, geht NACH dem Setup in `/profile?tab=edit`. Hier zählt
 * nur: einmal kurz die Pflicht-Info ablegen, dann ab in die Lobby.
 *
 * Standard-Sichtbarkeit bleibt `LOGGED_IN` (siehe DEFAULT_VISIBILITY im
 * Backend) — Mitspieler am Tisch sehen den Klarnamen, aber nicht
 * öffentlich indexierbar.
 */
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { api, ApiError } from "~/lib/api";

export const Route = createFileRoute("/_auth/setup")({
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: (payload: { realFirstName: string; realLastName: string }) =>
      api("/api/users/me", { method: "PATCH", body: payload }),
    onSuccess: () => {
      // Nach erfolgreichem Setup geht's in die Lobby. Wir benutzen
      // `replace`, damit der Back-Button den User nicht zurück ins
      // Setup wirft.
      void navigate({ to: "/lobby", replace: true });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Konnte nicht speichern.");
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (fn.length === 0 || ln.length === 0) {
      setError("Bitte gib Vor- und Nachnamen ein.");
      return;
    }
    saveMut.mutate({ realFirstName: fn, realLastName: ln });
  }

  return (
    <section className="max-w-md mx-auto space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-jass-ink">Willkommen!</h1>
        <p className="text-sm text-jass-inkSoft">
          Damit deine Mitspieler wissen, wer du bist, brauchen wir einmalig deinen Vor- und
          Nachnamen. Standardmäßig sehen den nur eingeloggte Spieler, nicht das offene Internet —
          das kannst du jederzeit im Profil ändern.
        </p>
      </header>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block">
          <span className="block text-sm font-medium text-jass-ink mb-1">Vorname</span>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.currentTarget.value)}
            maxLength={80}
            required
            autoFocus
            className="w-full rounded border border-stone-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-jass-ink mb-1">Nachname</span>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.currentTarget.value)}
            maxLength={80}
            required
            className="w-full rounded border border-stone-300 px-3 py-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={saveMut.isPending} className="btn-jass-primary">
            {saveMut.isPending ? "Speichere…" : "Weiter zur Lobby"}
          </button>
        </div>
      </form>
    </section>
  );
}
