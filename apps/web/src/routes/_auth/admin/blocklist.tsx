/**
 * Blocklist-CRUD. E-Mail-Patterns (z.B. `@spam.test`, `*@bad.tld`,
 * `bot123@example.com`), die bei der Registrierung greifen.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import type { BlocklistEntry } from "~/features/admin/types";
import { api, ApiError } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/blocklist")({
  component: BlocklistPage,
});

function BlocklistPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["admin", "blocklist"] as const;
  const { data, isPending } = useQuery<{ entries: BlocklistEntry[] }>({
    queryKey,
    queryFn: () => api("/api/admin/blocklist"),
  });

  const [pattern, setPattern] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addMut = useMutation({
    mutationFn: () =>
      api("/api/admin/blocklist", {
        method: "POST",
        body: { pattern, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      }),
    onSuccess: () => {
      setPattern("");
      setReason("");
      setError(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : t("admin.blocklist.addError"));
    },
  });

  const removeMut = useMutation({
    mutationFn: (p: string) =>
      api(`/api/admin/blocklist/${encodeURIComponent(p)}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    addMut.mutate();
  }

  return (
    <section className="space-y-4">
      <form onSubmit={onAdd} className="space-y-2 max-w-xl">
        <h2 className="text-xl font-semibold">{t("admin.blocklist.addHeading")}</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={t("admin.blocklist.patternPlaceholder")}
            required
            className="flex-1 rounded border border-stone-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={addMut.isPending}
            className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {t("admin.blocklist.add")}
          </button>
        </div>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("admin.blocklist.reasonPlaceholder")}
          className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
      </form>

      <div>
        <h2 className="text-xl font-semibold mb-2">{t("admin.blocklist.listHeading")}</h2>
        {isPending && <p className="text-stone-500">{t("admin.blocklist.loading")}</p>}
        {data && data.entries.length === 0 && (
          <p className="text-sm text-stone-500 italic">{t("admin.blocklist.empty")}</p>
        )}
        {data && data.entries.length > 0 && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-stone-300 text-left text-stone-600">
                <th className="py-2 pr-3">{t("admin.blocklist.colPattern")}</th>
                <th className="py-2 pr-3">{t("admin.blocklist.colReason")}</th>
                <th className="py-2 pr-3">{t("admin.blocklist.colSince")}</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.pattern} className="border-b border-stone-100">
                  <td className="py-2 pr-3 font-mono text-xs">{e.pattern}</td>
                  <td className="py-2 pr-3 text-stone-600">{e.reason ?? "—"}</td>
                  <td className="py-2 pr-3 text-stone-500 text-xs">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => removeMut.mutate(e.pattern)}
                      disabled={removeMut.isPending}
                      className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-rose-50"
                    >
                      {t("admin.blocklist.delete")}
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
