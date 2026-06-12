/**
 * Profil-History: Liste der eigenen Spiele in chronologischer Reihenfolge,
 * mit Kontext-Verlinkung („Mitspieler: …") und Direkt-Link zum Replay.
 *
 * Datenquelle: `GET /api/games` (vom ReplayService.listUserGames).
 *
 * UI-Design:
 *   - Eine Karte pro Spiel
 *   - Statusbadge (lief / Sieg / Niederlage / Unentschieden / Matsch)
 *   - Endstand als „own : opp" aus eigener Team-Perspektive
 *   - Mitspieler-Namen (KI-Sitze als „KI" markiert)
 *   - Link zum Replay
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { aiName } from "~/features/game/aiNames";
import { api, ApiError } from "~/lib/api";

import type { ReplaySeat, UserGameSummary } from "./types";

interface Props {
  /** Optionale Pagination — default 50/0. */
  limit?: number;
  offset?: number;
}

export function GameHistoryList({ limit = 50, offset = 0 }: Props) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery<{ games: UserGameSummary[] }>({
    queryKey: ["games", "mine", { limit, offset }],
    queryFn: () => api<{ games: UserGameSummary[] }>(`/api/games?limit=${limit}&offset=${offset}`),
  });

  if (isLoading) {
    return <p className="text-stone-500">{t("profile.history.loading")}</p>;
  }
  if (error) {
    const msg = error instanceof ApiError ? error.message : String(error);
    return (
      <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900 text-sm">
        {t("profile.history.loadError", { message: msg })}
      </p>
    );
  }
  if (!data || data.games.length === 0) {
    return <p className="text-stone-500 text-sm">{t("profile.history.empty")}</p>;
  }

  return (
    <ul className="space-y-2">
      {data.games.map((g) => (
        <GameHistoryItem key={g.gameId} game={g} />
      ))}
    </ul>
  );
}

function GameHistoryItem({ game }: { game: UserGameSummary }) {
  const { t } = useTranslation();
  const myTeam = game.myTeam;
  const otherTeam = 1 - myTeam;
  const ownPts = game.finalScore?.team_card_points[myTeam] ?? 0;
  const oppPts = game.finalScore?.team_card_points[otherTeam] ?? 0;
  const result =
    game.status !== "finished"
      ? "running"
      : game.finalScore?.matsch_team === myTeam
        ? "matsch-won"
        : game.finalScore?.matsch_team === otherTeam
          ? "matsch-lost"
          : ownPts > oppPts
            ? "won"
            : ownPts < oppPts
              ? "lost"
              : "draw";
  const badgeClass = badgeForResult(result);
  const badgeLabel = labelForResult(result, t);
  const partnerNames = collectPartners(game.seats, game.mySeat, game.gameId).join(", ");
  const shortId = game.gameId.slice(-6);

  return (
    <li className="rounded border border-stone-200 bg-white p-3 flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <time className="text-xs text-stone-500" dateTime={game.startedAt}>
          {new Date(game.startedAt).toLocaleString("de-AT")}
        </time>
        <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
          {t(`profile.stats.variant.${game.variant}`)}
        </span>
        <span className={`text-xs rounded px-2 py-0.5 ${badgeClass}`}>{badgeLabel}</span>
        {game.status === "finished" ? (
          <span className="text-sm tabular-nums">
            {t("profile.history.finalScore", { own: ownPts, opp: oppPts })}
          </span>
        ) : (
          <span className="text-sm text-stone-500">{t("profile.history.running")}</span>
        )}
        <Link
          to="/replay/$gameId"
          params={{ gameId: game.gameId }}
          className="ml-auto text-sm text-stone-700 underline"
        >
          {t("profile.history.viewReplay")} →
        </Link>
      </div>
      <p className="text-xs text-stone-600">
        {t("profile.history.duringGame", { shortId, partners: partnerNames || "—" })}
      </p>
    </li>
  );
}

function collectPartners(seats: readonly ReplaySeat[], mySeat: number, gameId: string): string[] {
  return seats
    .filter((s) => s.seat !== mySeat)
    .sort((a, b) => a.seat - b.seat)
    .map(
      (s) => s.displayName ?? (s.aiSeatType ? aiName(`${gameId}:${s.seat}`, s.aiSeatType) : `?`)
    );
}

type ResultKind = "running" | "won" | "lost" | "draw" | "matsch-won" | "matsch-lost";

function badgeForResult(r: ResultKind): string {
  switch (r) {
    case "running":
      return "bg-stone-100 text-stone-700";
    case "won":
      return "bg-emerald-100 text-emerald-900";
    case "lost":
      return "bg-rose-100 text-rose-900";
    case "draw":
      return "bg-amber-100 text-amber-900";
    case "matsch-won":
      return "bg-emerald-600 text-white";
    case "matsch-lost":
      return "bg-rose-600 text-white";
  }
}

function labelForResult(r: ResultKind, t: (key: string) => string): string {
  switch (r) {
    case "running":
      return t("profile.history.running");
    case "won":
      return t("profile.history.won");
    case "lost":
      return t("profile.history.lost");
    case "draw":
      return t("profile.history.draw");
    case "matsch-won":
      return `${t("profile.history.matsch")} (${t("profile.history.won")})`;
    case "matsch-lost":
      return `${t("profile.history.matsch")} (${t("profile.history.lost")})`;
  }
}
