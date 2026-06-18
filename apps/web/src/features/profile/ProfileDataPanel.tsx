/**
 * „Meine Daten"-Tab im Profil.
 *
 * - **Datenexport (M10-C)**: triggert `GET /api/users/me/export` und
 *   speichert die Antwort als JSON-Datei via Blob + Object-URL. Kein
 *   externes ZIP-Lib — DSGVO Art. 20 verlangt nur „strukturiert,
 *   gängig, maschinenlesbar", und das erfüllt JSON.
 * - **Account-Löschung (M10-D)**: nach Bestätigung Aufruf an
 *   `DELETE /api/users/me`. Die Session wird serverseitig invalidiert;
 *   der Client navigiert anschließend hart zur Login-Seite.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";

import { api, ApiError } from "~/lib/api";
import { appHref } from "~/lib/app-path";

export function ProfileDataPanel() {
  return (
    <div className="space-y-4">
      <ExportSection />
      <DeleteSection />
    </div>
  );
}

function ExportSection() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onExport(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Direkter fetch statt `api()`, weil wir die rohe Response für den
      // Blob-Download brauchen — der Wrapper würde JSON.parse aufrufen,
      // was den Bytes-Stream stört.
      const res = await fetch("/api/users/me/export");
      if (!res.ok) {
        throw new Error(t("profile.data.serverError", { status: res.status }));
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `heb-ab-export-${Date.now()}.json`;
      triggerDownload(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border border-stone-200 bg-white p-4 space-y-2">
      <h2 className="text-lg font-semibold">{t("profile.data.exportTitle")}</h2>
      <p className="text-sm text-stone-700">{t("profile.data.exportIntro")}</p>
      <button
        type="button"
        onClick={() => void onExport()}
        disabled={busy}
        className="rounded border border-stone-300 px-3 py-1.5 text-sm text-stone-800 hover:bg-stone-50 disabled:opacity-50"
      >
        {busy ? t("profile.data.exporting") : t("profile.data.exportButton")}
      </button>
      {error && (
        <p role="alert" className="text-sm text-rose-800">
          {t("profile.data.exportError", { message: error })}
        </p>
      )}
    </section>
  );
}

function DeleteSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const CONFIRM_PHRASE = "LÖSCHEN";

  async function onDelete(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api("/api/users/me", { method: "DELETE", raw: true });
      // Hard-Reload statt Router-Navigate, damit React-Query + Session-
      // Cache komplett zurückgesetzt sind und nicht die alte Identity
      // weiterhält.
      window.location.href = appHref("/login");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setBusy(false);
    }
    // bewusst kein finally: nach Erfolg navigieren wir weg
    void navigate;
  }

  return (
    <section className="rounded border border-rose-300 bg-rose-50 p-4 space-y-3">
      <h2 className="text-lg font-semibold text-rose-900">{t("profile.data.deleteTitle")}</h2>
      <p className="text-sm text-rose-900">
        <Trans i18nKey="profile.data.deleteIntro" components={{ code: <code /> }} />
      </p>
      <p className="text-sm text-rose-900">
        <Trans
          i18nKey="profile.data.deleteConfirmPrompt"
          values={{ phrase: CONFIRM_PHRASE }}
          components={{ strong: <strong /> }}
        />
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.currentTarget.value)}
        className="rounded border border-rose-300 px-2 py-1 text-sm bg-white"
        aria-label={t("profile.data.confirmAria")}
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => void onDelete()}
        disabled={busy || confirmText !== CONFIRM_PHRASE}
        className="block rounded bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? t("profile.data.deleting") : t("profile.data.deleteButton")}
      </button>
      {error && (
        <p role="alert" className="text-sm text-rose-900">
          {t("profile.data.deleteError", { message: error })}
        </p>
      )}
    </section>
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
