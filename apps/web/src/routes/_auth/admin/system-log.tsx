/**
 * System-Log-View: die letzten WARN/ERROR/FATAL-Logzeilen aus dem flüchtigen
 * In-Memory-Ringpuffer der API (max. 500). Anders als der Audit-Log ist das
 * NICHT persistent — nach einem API-Neustart ist die Liste leer. Gedacht für
 * den schnellen Blick „was ist gerade schiefgelaufen".
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { SystemLogEntry } from "~/features/admin/types";
import { api } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/system-log")({
  component: SystemLogPage,
});

const levelBadge = (label: string): string => {
  switch (label) {
    case "error":
      return "bg-rose-100 text-rose-800";
    case "fatal":
      return "bg-rose-200 text-rose-900 font-bold";
    default:
      return "bg-amber-100 text-amber-800";
  }
};

function SystemLogPage() {
  const { t } = useTranslation();
  const [onlyErrors, setOnlyErrors] = useState(false);

  const { data, isPending, error, refetch, isFetching } = useQuery<{ entries: SystemLogEntry[] }>({
    queryKey: ["admin", "system-log"],
    queryFn: () => api("/api/admin/system-log"),
    // Frisch genug für einen Blick, ohne Dauerlast.
    refetchInterval: 15_000,
  });

  const entries = (data?.entries ?? []).filter((e) => (onlyErrors ? e.level >= 50 : true));

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={onlyErrors}
            onChange={(e) => setOnlyErrors(e.target.checked)}
          />
          {t("admin.systemLog.onlyErrors")}
        </label>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="ml-auto rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50"
        >
          {t("admin.systemLog.refresh")}
        </button>
      </header>

      <p className="text-xs text-stone-500">{t("admin.systemLog.hint")}</p>

      {isPending && <p className="text-stone-500">{t("admin.systemLog.loading")}</p>}
      {error && (
        <p role="alert" className="text-rose-700">
          {error.message}
        </p>
      )}

      {data && entries.length === 0 && (
        <p className="text-sm italic text-stone-500">{t("admin.systemLog.empty")}</p>
      )}

      {entries.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-600">
              <th className="py-2 pr-3">{t("admin.systemLog.colWhen")}</th>
              <th className="py-2 pr-3">{t("admin.systemLog.colLevel")}</th>
              <th className="py-2 pr-3">{t("admin.systemLog.colContext")}</th>
              <th className="py-2 pr-3">{t("admin.systemLog.colMessage")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={`${e.time}-${i}`} className="border-b border-stone-100 align-top">
                <td className="py-1 pr-3 whitespace-nowrap text-stone-500">
                  {new Date(e.time).toLocaleString()}
                </td>
                <td className="py-1 pr-3">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[0.65rem] ${levelBadge(e.levelLabel)}`}
                  >
                    {e.levelLabel}
                  </span>
                </td>
                <td className="py-1 pr-3 font-mono text-stone-600">{e.context ?? "—"}</td>
                <td className="py-1 pr-3">
                  <span className="text-stone-800">{e.msg || "—"}</span>
                  {e.err?.message && e.err.message !== e.msg && (
                    <span className="block text-rose-700">{e.err.message}</span>
                  )}
                  {e.err?.stack && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-stone-400">
                        {t("admin.systemLog.stack")}
                      </summary>
                      <pre className="mt-1 max-w-[48rem] overflow-x-auto rounded bg-stone-50 p-2 text-[0.65rem] text-stone-600">
                        {e.err.stack}
                      </pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
