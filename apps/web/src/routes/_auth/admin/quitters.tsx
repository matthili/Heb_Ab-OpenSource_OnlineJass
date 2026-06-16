/**
 * Admin-Tab „Aussteiger" — Ranking nach abgebrochenen Partien (`game.abandoned`).
 * Spieler mit hohem „mit Menschen"-Score haben wiederholt echte Mitspieler im
 * Stich gelassen; KI-Tische zu verlassen zählt mit, wiegt aber weniger schwer.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { UserName } from "~/features/social/UserName";
import { api } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/quitters")({
  component: QuittersPage,
});

interface QuitterEntry {
  userId: string;
  userName: string | null;
  total: number;
  withHumans: number;
  lastAbandonAt: string;
}

function QuittersPage() {
  const { t } = useTranslation();
  const { data, isPending, error } = useQuery<{ entries: QuitterEntry[] }>({
    queryKey: ["admin", "quitters"],
    queryFn: () => api("/api/admin/quitters"),
  });

  return (
    <section className="space-y-3">
      <p className="text-stone-600">{t("admin.quitters.intro")}</p>

      {isPending && <p className="text-stone-500">{t("admin.quitters.loading")}</p>}
      {error && (
        <p role="alert" className="text-rose-700">
          {error.message}
        </p>
      )}
      {data && data.entries.length === 0 && (
        <p className="italic text-stone-500">{t("admin.quitters.empty")}</p>
      )}

      {data && data.entries.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-1 font-medium">{t("admin.quitters.player")}</th>
              <th className="py-1 text-right font-medium">{t("admin.quitters.withHumans")}</th>
              <th className="py-1 text-right font-medium">{t("admin.quitters.total")}</th>
              <th className="py-1 text-right font-medium">{t("admin.quitters.last")}</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.userId} className="border-b border-stone-100">
                <td className="py-1">
                  {e.userName ? (
                    <UserName userId={e.userId} name={e.userName} />
                  ) : (
                    <span className="text-stone-400">{e.userId.slice(0, 8)}…</span>
                  )}
                </td>
                <td className="py-1 text-right font-semibold text-jass-red">{e.withHumans}</td>
                <td className="py-1 text-right text-stone-600">{e.total}</td>
                <td className="py-1 text-right text-stone-500">
                  {new Date(e.lastAbandonAt).toLocaleDateString("de-AT")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
