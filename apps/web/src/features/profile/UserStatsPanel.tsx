/**
 * Spiel-Statistik.
 *
 * `UserStatsPanel` = eigene Statistik (Endpunkt `GET /api/users/me/stats`).
 * `StatsTable` = reine Darstellung (Totals + Tabelle pro Variante), damit auch
 * das öffentliche Fremdprofil dieselbe Anzeige nutzen kann (Daten kommen dort
 * eingebettet im Profil, gated über die `stats`-Sichtbarkeit).
 *
 * Zeigt pro Variante: Anzahl Partien, Siege, Win-Rate (%) und Ø eigene Punkte.
 */
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { api } from "~/lib/api";

export interface VariantStat {
  variant: string;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  avgOwnPoints: number;
}

export interface UserStatsData {
  perVariant: VariantStat[];
  totals: { gamesPlayed: number; gamesWon: number };
}

/** Übersetzt einen Varianten-Code; fällt auf den Roh-Code zurück, falls unbekannt. */
function variantLabel(variant: string, t: TFunction): string {
  const key = `profile.stats.variant.${variant}`;
  const label = t(key);
  // i18next gibt bei fehlendem Key den Key selbst zurück — dann Roh-Code zeigen.
  return label === key ? variant : label;
}

export function UserStatsPanel() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery<UserStatsData>({
    queryKey: ["me", "stats"],
    queryFn: () => api("/api/users/me/stats"),
    staleTime: 30_000,
  });

  if (isPending) {
    return <p className="text-stone-500 text-sm">{t("profile.stats.loading")}</p>;
  }
  if (isError || !data) {
    return null;
  }
  if (data.totals.gamesPlayed === 0) {
    return (
      <section className="rounded border border-stone-200 p-3 text-sm text-stone-600">
        {t("profile.stats.empty")}
      </section>
    );
  }

  return <StatsTable stats={data} />;
}

/** Reine Darstellung der Statistik. Annahme: `stats.totals.gamesPlayed > 0`. */
export function StatsTable({ stats }: { stats: UserStatsData }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">{t("profile.stats.title")}</h3>
      <div className="text-sm text-stone-600">
        <Trans
          i18nKey="profile.stats.summary"
          values={{
            played: stats.totals.gamesPlayed,
            won: stats.totals.gamesWon,
            rate: formatRate(stats.totals.gamesWon, stats.totals.gamesPlayed, t),
          }}
          components={{ strong: <strong /> }}
        />
      </div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-600">
            <th className="py-2 pr-3">{t("profile.stats.colVariant")}</th>
            <th className="py-2 pr-3 text-right">{t("profile.stats.colMatches")}</th>
            <th className="py-2 pr-3 text-right">{t("profile.stats.colWins")}</th>
            <th className="py-2 pr-3 text-right">{t("profile.stats.colWinRate")}</th>
            <th className="py-2 pr-3 text-right">{t("profile.stats.colAvgPoints")}</th>
          </tr>
        </thead>
        <tbody>
          {stats.perVariant.map((v) => (
            <tr key={v.variant} className="border-b border-stone-100">
              <td className="py-2 pr-3">{variantLabel(v.variant, t)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{v.gamesPlayed}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{v.gamesWon}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {(v.winRate * 100).toFixed(0)} %
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{v.avgOwnPoints.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatRate(wins: number, total: number, t: TFunction): string {
  if (total === 0) return t("profile.stats.noValue");
  return t("profile.stats.winRateSuffix", { rate: ((wins / total) * 100).toFixed(0) });
}
