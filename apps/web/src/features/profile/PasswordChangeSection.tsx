/**
 * „Passwort ändern" unter Profil bearbeiten.
 *
 * Ruft Better Auths `/change-password` über den Auth-Client mit aktuellem und
 * neuem Passwort. Was danach passiert, regelt der Server (`auth.service.ts`):
 * Stärke- und Leak-Prüfung wie bei der Registrierung, alle ANDEREN Sitzungen
 * enden samt Live-Verbindungen (dieser Tab bleibt angemeldet), Audit-Eintrag
 * und Hinweis-Mail ans Konto.
 *
 * Das versteckte Benutzername-Feld hilft Passwort-Managern, das neue Passwort
 * dem richtigen Konto zuzuordnen.
 */
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { authClient } from "~/lib/auth-client";

/** Wie `minPasswordLength` im Backend. */
const MIN_LENGTH = 12;

export function PasswordChangeSection({ email }: { email: string }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function messageFor(err: {
    status?: number | undefined;
    code?: string | undefined;
    message?: string | undefined;
  }): string {
    if (err.status === 429) return t("profile.edit.password.tooManyRequests");
    if (err.code === "INVALID_PASSWORD") return t("profile.edit.password.wrongCurrent");
    if (err.code === "PASSWORD_TOO_SHORT") return t("profile.edit.password.tooShort");
    // Zu schwach / in einem Datenleck: die Meldung des Servers nennt den Grund.
    return err.message ?? t("profile.edit.password.error");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < MIN_LENGTH) {
      setError(t("profile.edit.password.tooShort"));
      return;
    }
    if (next !== repeat) {
      setError(t("profile.edit.password.mismatch"));
      return;
    }
    if (next === current) {
      setError(t("profile.edit.password.same"));
      return;
    }
    setSaving(true);
    try {
      const res = await authClient.changePassword({ currentPassword: current, newPassword: next });
      if (res.error) {
        setError(messageFor(res.error));
        return;
      }
      setCurrent("");
      setNext("");
      setRepeat("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("profile.edit.password.error"));
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded border border-stone-300 px-2 py-1 text-sm";
  const ready = current.length > 0 && next.length > 0 && repeat.length > 0;

  return (
    <section className="space-y-2 rounded border border-stone-200 p-4">
      <h2 className="text-lg font-semibold">{t("profile.edit.password.title")}</h2>
      <p className="text-xs text-stone-500">{t("profile.edit.password.help")}</p>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-2">
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        <label className="block space-y-1 text-sm">
          <span>{t("profile.edit.password.current")}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.currentTarget.value)}
            maxLength={128}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t("profile.edit.password.new")}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
            minLength={MIN_LENGTH}
            maxLength={128}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t("profile.edit.password.repeat")}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.currentTarget.value)}
            maxLength={128}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={saving || !ready}
          className="rounded bg-stone-900 px-3 py-1 text-sm text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {saving ? t("profile.edit.password.submitting") : t("profile.edit.password.submit")}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-xs text-emerald-700">
          {t("profile.edit.password.success")}
        </p>
      )}
    </section>
  );
}
