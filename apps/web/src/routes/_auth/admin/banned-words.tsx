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

import type { BannedWordEntry } from "~/features/admin/types";
import { api, ApiError } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/banned-words")({
  component: BannedWordsPage,
});

function BannedWordsPage() {
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
      setError(err instanceof ApiError ? err.message : "Hinzufügen fehlgeschlagen.");
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
        Wörter, die in Chat-Nachrichten (Lobby, Spiel, DM) durch <code>***</code> ersetzt werden.
        Substring-Match, Groß-/Kleinschreibung egal. Für die Sperre von Registrierungen siehe{" "}
        <em>Blocklist</em> — anderes Feature.
      </p>
      <form onSubmit={onAdd} className="space-y-2 max-w-xl">
        <h2 className="text-xl font-semibold">Wort hinzufügen</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="z.B. Schimpfwort"
            required
            maxLength={64}
            className="flex-1 rounded border border-stone-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={addMut.isPending}
            className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            Hinzufügen
          </button>
        </div>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Grund (optional, intern sichtbar)"
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
        <h2 className="text-xl font-semibold mb-2">Aktuelle Liste</h2>
        {isPending && <p className="text-stone-500">Lade …</p>}
        {data && data.entries.length === 0 && (
          <p className="text-sm text-stone-500 italic">
            Keine Wörter eingetragen — Chat-Moderation ist aktuell ungefiltert.
          </p>
        )}
        {data && data.entries.length > 0 && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-stone-300 text-left text-stone-600">
                <th className="py-2 pr-3">Wort</th>
                <th className="py-2 pr-3">Grund</th>
                <th className="py-2 pr-3">Seit</th>
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
                      Löschen
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
