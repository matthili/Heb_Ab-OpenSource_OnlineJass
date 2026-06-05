/**
 * Öffentliches Leaderboard pro Spielvariante (Opt-in pro Nutzer).
 *
 * Variant-Tabs oben, Tabelle darunter. Daten von `GET /api/leaderboard`,
 * cache 60 s — die Liste ändert sich nicht im Sekundentakt.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "~/lib/api";

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  avgOwnPoints: number;
}
interface LeaderboardResponse {
  variant: string;
  entries: LeaderboardEntry[];
}

const VARIANTS = [{ id: "KREUZ_4P" }, { id: "SOLO_4P" }, { id: "BODENSEE_2P" }] as const;
type VariantId = (typeof VARIANTS)[number]["id"];

export const Route = createFileRoute("/_public/leaderboard")({
  component: LeaderboardPage,
});

function LeaderboardPage() {
  const { t } = useTranslation();
  const [variant, setVariant] = useState<VariantId>("KREUZ_4P");
  const { data, isPending } = useQuery<LeaderboardResponse>({
    queryKey: ["leaderboard", variant],
    queryFn: () => api(`/api/leaderboard?variant=${variant}`),
    staleTime: 60_000,
  });

  return (
    <section className="space-y-4 max-w-3xl mx-auto p-4">
      <header className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">{t("leaderboard.title")}</h1>
        <Link to="/lobby" className="ml-auto text-sm text-stone-600 underline">
          {t("leaderboard.toLobby")}
        </Link>
      </header>
      <p className="text-sm text-stone-600">{t("leaderboard.intro")}</p>

      <nav className="flex gap-1 border-b border-stone-200 text-sm">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVariant(v.id)}
            className={
              "px-3 py-2 -mb-px border-b-2 " +
              (variant === v.id
                ? "border-stone-900 text-stone-900 font-medium"
                : "border-transparent text-stone-600 hover:text-stone-900")
            }
          >
            {t(`leaderboard.variant.${v.id}`)}
          </button>
        ))}
      </nav>

      {isPending && <p className="text-stone-500 text-sm">{t("leaderboard.loading")}</p>}
      {data && data.entries.length === 0 && (
        <p className="text-sm text-stone-500 italic">{t("leaderboard.empty")}</p>
      )}
      {data && data.entries.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-600">
              <th className="py-2 pr-3 w-12">{t("leaderboard.colRank")}</th>
              <th className="py-2 pr-3">{t("leaderboard.colPlayer")}</th>
              <th className="py-2 pr-3 text-right">{t("leaderboard.colMatches")}</th>
              <th className="py-2 pr-3 text-right">{t("leaderboard.colWins")}</th>
              <th className="py-2 pr-3 text-right">{t("leaderboard.colWinRate")}</th>
              <th className="py-2 pr-3 text-right">{t("leaderboard.colAvgPoints")}</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.userId} className="border-b border-stone-100">
                <td className="py-2 pr-3 tabular-nums text-stone-500">{e.rank}</td>
                <td className="py-2 pr-3 font-medium">{e.name}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{e.gamesPlayed}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{e.gamesWon}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {(e.winRate * 100).toFixed(0)} %
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{e.avgOwnPoints.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
