/**
 * Audit-Log-View. Action-Prefix-Filter + Pagination via `before`.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import type { AdminAuditEntry } from "~/features/admin/types";
import { api } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/audit")({
  component: AuditPage,
});

function AuditPage() {
  const [prefix, setPrefix] = useState("");
  const [before, setBefore] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (prefix) params.set("actionPrefix", prefix);
  if (before) params.set("before", before);
  params.set("limit", "100");

  const { data, isPending, error } = useQuery<{ entries: AdminAuditEntry[] }>({
    queryKey: ["admin", "audit", prefix, before],
    queryFn: () => api(`/api/admin/audit?${params.toString()}`),
  });

  return (
    <section className="space-y-3">
      <header className="flex gap-2 flex-wrap items-center">
        <input
          type="text"
          value={prefix}
          onChange={(e) => {
            setPrefix(e.target.value);
            setBefore(null);
          }}
          placeholder="Action-Prefix, z.B. auth. oder admin.blocklist."
          className="rounded border border-stone-300 px-3 py-1.5 text-sm flex-1 min-w-[16rem]"
        />
        {before && (
          <button
            type="button"
            onClick={() => setBefore(null)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Erste Seite
          </button>
        )}
      </header>

      {isPending && <p className="text-stone-500">Lade …</p>}
      {error && (
        <p role="alert" className="text-rose-700">
          {error.message}
        </p>
      )}

      {data && data.entries.length === 0 && (
        <p className="text-sm text-stone-500 italic">Keine Einträge.</p>
      )}

      {data && data.entries.length > 0 && (
        <>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-stone-300 text-left text-stone-600">
                <th className="py-2 pr-3">Wann</th>
                <th className="py-2 pr-3">Akteur</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Target</th>
                <th className="py-2 pr-3">Meta</th>
                <th className="py-2 pr-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className="border-b border-stone-100 align-top">
                  <td className="py-1 pr-3 text-stone-500 whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="py-1 pr-3">
                    {e.actorName ?? <span className="text-stone-400">—</span>}
                  </td>
                  <td className="py-1 pr-3 font-mono">{e.action}</td>
                  <td className="py-1 pr-3 font-mono">{e.target ?? "—"}</td>
                  <td className="py-1 pr-3 font-mono text-stone-600 max-w-[20rem] truncate">
                    {e.meta ? JSON.stringify(e.meta) : "—"}
                  </td>
                  <td className="py-1 pr-3 text-stone-500">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.entries.length >= 100 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const last = data.entries[data.entries.length - 1];
                  if (last) setBefore(last.createdAt);
                }}
                className="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
              >
                Ältere laden →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
