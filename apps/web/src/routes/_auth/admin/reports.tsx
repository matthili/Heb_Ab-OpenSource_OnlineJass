/**
 * Admin-Tab „Meldungen" — gemeldete User prüfen + Status setzen.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { UserName } from "~/features/social/UserName";
import { api } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/reports")({
  component: ReportsPage,
});

interface AdminReport {
  id: string;
  reporterId: string;
  reporterName: string;
  reportedUserId: string;
  reportedUserName: string;
  context: string;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

const STATUSES = ["PENDING", "REVIEWED", "DISMISSED", "ACTION_TAKEN"] as const;

function ReportsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");

  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  params.set("limit", "100");

  const { data, isPending, error } = useQuery<{ reports: AdminReport[] }>({
    queryKey: ["admin", "reports", statusFilter],
    queryFn: () => api(`/api/admin/reports?${params.toString()}`),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/api/admin/reports/${id}/status`, { method: "PATCH", body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "reports"] }),
  });

  const filterBtn = (value: string, label: string) => (
    <button
      key={value || "all"}
      type="button"
      onClick={() => setStatusFilter(value)}
      aria-pressed={statusFilter === value}
      className={`rounded-full border px-3 py-1 text-sm ${
        statusFilter === value ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {filterBtn("", t("admin.reports.filterAll"))}
        {STATUSES.map((s) => filterBtn(s, t(`admin.reports.status.${s}`)))}
      </div>

      {isPending && <p className="text-stone-500">{t("admin.reports.loading")}</p>}
      {error && (
        <p role="alert" className="text-rose-700">
          {error.message}
        </p>
      )}
      {data && data.reports.length === 0 && (
        <p className="italic text-stone-500">{t("admin.reports.empty")}</p>
      )}

      <ul className="space-y-2">
        {data?.reports.map((r) => (
          <li key={r.id} className="space-y-1 rounded border border-stone-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline gap-2 text-sm">
              <UserName
                userId={r.reportedUserId}
                name={r.reportedUserName}
                className="font-semibold"
              />
              <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-900">
                {t(`social.report.reason.${r.reason}`)}
              </span>
              <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-700">
                {t(`social.report.context.${r.context}`)}
              </span>
              <span className="rounded bg-stone-200 px-2 py-0.5 text-xs text-stone-700">
                {t(`admin.reports.status.${r.status}`)}
              </span>
              <span className="ml-auto text-xs text-stone-500">
                {new Date(r.createdAt).toLocaleString("de-AT")}
              </span>
            </div>
            <p className="text-xs text-stone-500">
              {t("admin.reports.reportedBy")}{" "}
              <UserName userId={r.reporterId} name={r.reporterName} />
            </p>
            {r.note && <p className="text-sm text-stone-700">„{r.note}"</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {STATUSES.filter((s) => s !== r.status).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: r.id, status: s })}
                  className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50 disabled:opacity-50"
                >
                  → {t(`admin.reports.status.${s}`)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
