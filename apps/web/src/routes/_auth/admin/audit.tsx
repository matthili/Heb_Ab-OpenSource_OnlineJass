/**
 * Audit-Log-View. Action-Prefix-Filter + Pagination via `before`.
 *
 * Die Meta-Spalte ist einzeilig gekürzt; ein Klick auf die Zeile (oder per
 * Tastatur auf die Meta-Vorschau) klappt darunter eine Detailzeile über die
 * volle Breite auf — mit dem vollständigen, eingerückten JSON. Mehrere Zeilen
 * dürfen gleichzeitig offen sein.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AdminAuditEntry } from "~/features/admin/types";
import { api } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/audit")({
  component: AuditPage,
});

/** Nur Einträge mit tatsächlichem Inhalt sind aufklappbar (`{}` = nichts zu zeigen). */
function hasMetaContent(meta: unknown): boolean {
  if (meta === null || meta === undefined) return false;
  if (typeof meta === "object") return Object.keys(meta).length > 0;
  return true;
}

function AuditPage() {
  const { t } = useTranslation();
  const [prefix, setPrefix] = useState("");
  const [before, setBefore] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
          placeholder={t("admin.audit.prefixPlaceholder")}
          className="rounded border border-stone-300 px-3 py-1.5 text-sm flex-1 min-w-[16rem]"
        />
        {before && (
          <button
            type="button"
            onClick={() => setBefore(null)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            {t("admin.audit.firstPage")}
          </button>
        )}
      </header>

      {isPending && <p className="text-stone-500">{t("admin.audit.loading")}</p>}
      {error && (
        <p role="alert" className="text-rose-700">
          {error.message}
        </p>
      )}

      {data && data.entries.length === 0 && (
        <p className="text-sm text-stone-500 italic">{t("admin.audit.empty")}</p>
      )}

      {data && data.entries.length > 0 && (
        <>
          <p className="text-xs text-stone-500">{t("admin.audit.hint")}</p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-stone-300 text-left text-stone-600">
                <th className="py-2 pr-3">{t("admin.audit.colWhen")}</th>
                <th className="py-2 pr-3">{t("admin.audit.colActor")}</th>
                <th className="py-2 pr-3">{t("admin.audit.colAction")}</th>
                <th className="py-2 pr-3">{t("admin.audit.colTarget")}</th>
                <th className="py-2 pr-3">{t("admin.audit.colMeta")}</th>
                <th className="py-2 pr-3">{t("admin.audit.colIp")}</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => {
                const expandable = hasMetaContent(e.meta);
                const open = expandable && expanded.has(e.id);
                return (
                  <Fragment key={e.id}>
                    <tr
                      className={`align-top ${open ? "" : "border-b border-stone-100"} ${
                        expandable ? "cursor-pointer hover:bg-stone-50" : ""
                      }`}
                      onClick={
                        expandable
                          ? () => {
                              // Text markieren (zum Kopieren) soll die Zeile nicht
                              // nebenbei auf- oder zuklappen.
                              if (window.getSelection()?.toString()) return;
                              toggle(e.id);
                            }
                          : undefined
                      }
                    >
                      <td className="py-1 pr-3 text-stone-500 whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="py-1 pr-3">
                        {e.actorName ?? <span className="text-stone-400">—</span>}
                      </td>
                      <td className="py-1 pr-3 font-mono">{e.action}</td>
                      <td className="py-1 pr-3 font-mono">{e.target ?? "—"}</td>
                      <td className="py-1 pr-3 font-mono text-stone-600 max-w-[20rem]">
                        {expandable ? (
                          // Button = Tastatur-Zugang (Tab + Enter/Leertaste); die
                          // Maus darf auf die ganze Zeile klicken.
                          <button
                            type="button"
                            aria-expanded={open}
                            title={open ? t("admin.audit.collapse") : t("admin.audit.expand")}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              toggle(e.id);
                            }}
                            className="block w-full max-w-[20rem] truncate text-left"
                          >
                            <span aria-hidden="true" className="mr-1 text-stone-400">
                              {open ? "▾" : "▸"}
                            </span>
                            {JSON.stringify(e.meta)}
                          </button>
                        ) : e.meta ? (
                          JSON.stringify(e.meta)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-1 pr-3 text-stone-500">{e.ip ?? "—"}</td>
                    </tr>
                    {open && (
                      <tr className="border-b border-stone-100">
                        <td colSpan={6} className="pb-2 pr-3">
                          <pre className="whitespace-pre-wrap break-words rounded bg-stone-50 p-2 text-xs text-stone-700">
                            {JSON.stringify(e.meta, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
                {t("admin.audit.loadOlder")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
