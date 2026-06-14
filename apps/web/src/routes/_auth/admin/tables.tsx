/**
 * Admin-Tab „Tische" — aktive Tische einsehen + auflösen (Moderation und
 * Aufräumen verwaister/hängengebliebener Tische).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { UserName } from "~/features/social/UserName";
import { api } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/tables")({
  component: TablesPage,
});

interface AdminTable {
  id: string;
  ownerId: string;
  ownerName: string;
  status: string;
  variant: string;
  createdAt: string;
  humanCount: number;
  aiCount: number;
  humanNames: string[];
  ownerSeated: boolean;
}

function TablesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isPending, error } = useQuery<{ tables: AdminTable[] }>({
    queryKey: ["admin", "tables"],
    queryFn: () => api("/api/admin/tables"),
  });

  const close = useMutation({
    mutationFn: (id: string) => api(`/api/admin/tables/${id}/close`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "tables"] }),
  });

  return (
    <section className="space-y-3">
      <p className="text-stone-600">{t("admin.tables.intro")}</p>

      {isPending && <p className="text-stone-500">{t("admin.tables.loading")}</p>}
      {error && (
        <p role="alert" className="text-rose-700">
          {error.message}
        </p>
      )}
      {data && data.tables.length === 0 && (
        <p className="italic text-stone-500">{t("admin.tables.empty")}</p>
      )}

      <ul className="space-y-2">
        {data?.tables.map((tbl) => (
          <li key={tbl.id} className="space-y-1 rounded border border-stone-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="font-semibold">
                {t(`lobby.openTable.variant.${tbl.variant}.title`)}
              </span>
              <span className="rounded bg-stone-200 px-2 py-0.5 text-xs text-stone-700">
                {tbl.status}
              </span>
              {!tbl.ownerSeated && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                  {t("admin.tables.orphan")}
                </span>
              )}
              <span className="ml-auto text-xs text-stone-500">
                {new Date(tbl.createdAt).toLocaleString("de-AT")}
              </span>
            </div>
            <p className="text-xs text-stone-500">
              {t("admin.tables.owner")} <UserName userId={tbl.ownerId} name={tbl.ownerName} /> ·{" "}
              {t("admin.tables.seats", { humans: tbl.humanCount, ai: tbl.aiCount })}
              {tbl.humanNames.length > 0 ? ` · ${tbl.humanNames.join(", ")}` : ""}
            </p>
            <div className="pt-1">
              <button
                type="button"
                disabled={close.isPending}
                onClick={() => close.mutate(tbl.id)}
                className="rounded border border-jass-red px-3 py-1 text-xs text-jass-red hover:bg-jass-red/10 disabled:opacity-50"
              >
                {t("admin.tables.close")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
