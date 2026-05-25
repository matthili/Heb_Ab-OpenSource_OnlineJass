/**
 * Spiel-Statistik des eingeloggten Users.
 *
 * Zeigt pro Variante: Anzahl Partien, Siege, Win-Rate (%) und Avg eigene
 * Punkte. Daten vom Endpunkt `GET /api/users/me/stats` — keine Live-Updates,
 * `staleTime: 30s` reicht für Profil-Seite.
 */
import { useQuery } from "@tanstack/react-query";

import { api } from "~/lib/api";

interface VariantStat {
  variant: string;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  avgOwnPoints: number;
}

interface UserStatsResponse {
  perVariant: VariantStat[];
  totals: { gamesPlayed: number; gamesWon: number };
}

const VARIANT_LABEL: Record<string, string> = {
  KREUZ_4P: "Kreuz-Jass (4 Spieler)",
  KREUZ_6P: "Kreuz-Jass (6 Spieler)",
  KREUZ_STEIGERN: "Kreuz-Jass Steigern",
  SOLO_4P: "Solo-Jass (4 Spieler)",
  BODENSEE_2P: "Bodensee-Jass (2 Spieler)",
};

export function UserStatsPanel() {
  const { data, isPending, isError } = useQuery<UserStatsResponse>({
    queryKey: ["me", "stats"],
    queryFn: () => api("/api/users/me/stats"),
    staleTime: 30_000,
  });

  if (isPending) {
    return <p className="text-stone-500 text-sm">Lade Statistik …</p>;
  }
  if (isError || !data) {
    return null;
  }
  if (data.totals.gamesPlayed === 0) {
    return (
      <section className="rounded border border-stone-200 p-3 text-sm text-stone-600">
        Noch keine abgeschlossenen Partien. Sobald du ein Spiel zu Ende spielst, erscheint hier
        deine Bilanz.
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">Statistik</h3>
      <div className="text-sm text-stone-600">
        Insgesamt: <strong>{data.totals.gamesPlayed}</strong> Partien ·{" "}
        <strong>{data.totals.gamesWon}</strong> Siege ·{" "}
        {formatRate(data.totals.gamesWon, data.totals.gamesPlayed)}
      </div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-600">
            <th className="py-2 pr-3">Variante</th>
            <th className="py-2 pr-3 text-right">Partien</th>
            <th className="py-2 pr-3 text-right">Siege</th>
            <th className="py-2 pr-3 text-right">Win-Rate</th>
            <th className="py-2 pr-3 text-right">Ø Punkte</th>
          </tr>
        </thead>
        <tbody>
          {data.perVariant.map((v) => (
            <tr key={v.variant} className="border-b border-stone-100">
              <td className="py-2 pr-3">{VARIANT_LABEL[v.variant] ?? v.variant}</td>
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

function formatRate(wins: number, total: number): string {
  if (total === 0) return "—";
  return `${((wins / total) * 100).toFixed(0)} % Win-Rate`;
}
