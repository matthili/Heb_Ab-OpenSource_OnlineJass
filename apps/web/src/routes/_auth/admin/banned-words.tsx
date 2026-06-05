/**
 * Chat-Wortfilter-CRUD. Wörter, die in jedem Chat-Channel (Lobby/Spiel/DM)
 * vor dem Speichern durch `***` ersetzt werden.
 *
 * Vergleich zur Blocklist: andere Sache — die Blocklist sperrt
 * Registrierungen anhand von E-Mail-Patterns; die Banned-Words filtern
 * Chat-Nachrichten. Beide werden hier im Admin gepflegt.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { BannedWordEntry } from "~/features/admin/types";
import { api, ApiError } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/banned-words")({
  component: BannedWordsPage,
});

function BannedWordsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["admin", "banned-words"] as const;
  const { data, isPending } = useQuery<{ entries: BannedWordEntry[] }>({
    queryKey,
    queryFn: () => api("/api/admin/banned-words"),
  });

  const [word, setWord] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addMut = useMutation({
    mutationFn: () =>
      api("/api/admin/banned-words", {
        method: "POST",
        body: { word: word.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}) },
      }),
    onSuccess: () => {
      setWord("");
      setReason("");
      setError(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : t("admin.bannedWords.addError"));
    },
  });

  const removeMut = useMutation({
    mutationFn: (w: string) =>
      api(`/api/admin/banned-words/${encodeURIComponent(w)}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (word.trim().length === 0) return;
    addMut.mutate();
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-stone-600">
        <Trans i18nKey="admin.bannedWords.intro" components={{ code: <code />, em: <em /> }} />
      </p>
      <form onSubmit={onAdd} className="space-y-2 max-w-xl">
        <h2 className="text-xl font-semibold">{t("admin.bannedWords.addHeading")}</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={t("admin.bannedWords.wordPlaceholder")}
            required
            maxLength={64}
            className="flex-1 rounded border border-stone-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={addMut.isPending}
            className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {t("admin.bannedWords.add")}
          </button>
        </div>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("admin.bannedWords.reasonPlaceholder")}
          maxLength={500}
          className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
      </form>

      <div>
        <h2 className="text-xl font-semibold mb-2">{t("admin.bannedWords.listHeading")}</h2>
        {isPending && <p className="text-stone-500">{t("admin.bannedWords.loading")}</p>}
        {data && data.entries.length === 0 && (
          <p className="text-sm text-stone-500 italic">{t("admin.bannedWords.empty")}</p>
        )}
        {data && data.entries.length > 0 && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-stone-300 text-left text-stone-600">
                <th className="py-2 pr-3">{t("admin.bannedWords.colWord")}</th>
                <th className="py-2 pr-3">{t("admin.bannedWords.colReason")}</th>
                <th className="py-2 pr-3">{t("admin.bannedWords.colSince")}</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.word} className="border-b border-stone-100">
                  <td className="py-2 pr-3 font-mono text-xs">{e.word}</td>
                  <td className="py-2 pr-3 text-stone-600">{e.reason ?? "—"}</td>
                  <td className="py-2 pr-3 text-stone-500 text-xs">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => removeMut.mutate(e.word)}
                      disabled={removeMut.isPending}
                      className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-rose-50"
                    >
                      {t("admin.bannedWords.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
