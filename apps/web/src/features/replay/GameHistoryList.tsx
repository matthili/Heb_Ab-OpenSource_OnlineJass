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
import { UserName } from "~/features/social/UserName";
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
      {groupByMatch(data.games).map((grp) => (
        <MatchGroup key={grp.key} games={grp.games} />
      ))}
    </ul>
  );
}

/**
 * Gruppiert die (neueste-zuerst) Spiele nach Tisch — alle Einzelspiele EINER
 * Partie („Jass" bis zum Punkteziel) gehören zusammen. Spiele ohne Tisch
 * (direkt/Test) bleiben Einzelgruppen. Gruppen-Reihenfolge = nach jüngstem
 * Spiel (Liste ist bereits absteigend); innerhalb der Partie chronologisch
 * (Spiel 1 → n).
 */
function groupByMatch(
  games: readonly UserGameSummary[]
): { key: string; games: UserGameSummary[] }[] {
  const map = new Map<string, UserGameSummary[]>();
  const order: string[] = [];
  for (const g of games) {
    const key = g.tableId ?? g.gameId;
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
      order.push(key);
    }
    arr.push(g);
  }
  return order.map((key) => ({
    key,
    games: map
      .get(key)!
      .slice()
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  }));
}

/**
 * Eine Partie als aufklappbare Gruppe. Einzelspiele (oder tischlose Spiele)
 * werden ohne Hülle direkt gezeigt — sonst Kopfzeile mit Datum, Variante,
 * Spielanzahl, kumulativem Stand + Ausgang, aufklappbar zu den Einzelspielen.
 */
function MatchGroup({ games }: { games: UserGameSummary[] }) {
  const { t } = useTranslation();
  if (games.length <= 1) {
    return <GameHistoryItem game={games[0]!} />;
  }
  const first = games[0]!;
  // Solo wertet 4 Einzelkonten — ein sauberer Gegner-Gesamtwert lässt sich
  // daraus nicht bilden, daher dort nur die eigene Summe + kein Ausgang-Badge.
  const isSolo = first.variant === "SOLO_4P";
  let cumOwn = 0;
  let cumOpp = 0;
  for (const g of games) {
    const { ownPts, oppPts } = gamePoints(g);
    cumOwn += ownPts;
    cumOpp += oppPts;
  }
  const anyRunning = games.some((g) => g.status !== "finished");
  const result: ResultKind | null = anyRunning
    ? "running"
    : isSolo
      ? null
      : cumOwn > cumOpp
        ? "won"
        : cumOwn < cumOpp
          ? "lost"
          : "draw";
  return (
    <li className="rounded border border-stone-300 bg-stone-50">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-3 py-2">
          <span className="font-medium text-stone-800">{t("profile.history.match.label")}</span>
          <time className="text-xs text-stone-500" dateTime={first.startedAt}>
            {new Date(first.startedAt).toLocaleDateString("de-AT")}
          </time>
          <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
            {t(`profile.stats.variant.${first.variant}`)}
          </span>
          <span className="text-xs text-stone-600">
            {t("profile.history.match.games", { count: games.length })}
          </span>
          {result && (
            <span className={`rounded px-2 py-0.5 text-xs ${badgeForResult(result)}`}>
              {labelForResult(result, t)}
            </span>
          )}
          <span className="ml-auto text-sm tabular-nums text-stone-700">
            {isSolo
              ? t("profile.history.match.totalSolo", { own: cumOwn })
              : t("profile.history.match.total", { own: cumOwn, opp: cumOpp })}
          </span>
        </summary>
        <ul className="space-y-2 px-3 pb-3">
          {games.map((g) => (
            <GameHistoryItem key={g.gameId} game={g} />
          ))}
        </ul>
      </details>
    </li>
  );
}

function GameHistoryItem({ game }: { game: UserGameSummary }) {
  const { t } = useTranslation();
  const { ownPts, oppPts } = gamePoints(game);
  const result = gameResultKind(game, ownPts, oppPts);
  const badgeClass = badgeForResult(result);
  const badgeLabel = labelForResult(result, t);
  const partners = collectPartners(game.seats, game.mySeat, game.gameId);
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
        {t("profile.history.partnersPrefix", { shortId })}{" "}
        {partners.length === 0
          ? "—"
          : partners.map((p, i) => (
              <span key={`${p.name}-${i}`}>
                {i > 0 && ", "}
                {p.userId ? (
                  <UserName userId={p.userId} name={p.name} className="text-stone-700" />
                ) : (
                  p.name
                )}
              </span>
            ))}
      </p>
    </li>
  );
}

function collectPartners(
  seats: readonly ReplaySeat[],
  mySeat: number,
  gameId: string
): { userId: string | null; name: string }[] {
  return seats
    .filter((s) => s.seat !== mySeat)
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({
      userId: s.userId,
      name: s.displayName ?? (s.aiSeatType ? aiName(`${gameId}:${s.seat}`, s.aiSeatType) : "?"),
    }));
}

/**
 * Eigene + Gegner-Punkte eines Spiels — varianten-abhängig (exakt wie das
 * Backend `user-stats.service`): Bodensee + Solo werten pro SITZ, Kreuz pro
 * TEAM (Sitz % 2). Bei Solo (4 Konten) ist „opp" der beste Einzel-Gegner.
 */
function gamePoints(game: UserGameSummary): { ownPts: number; oppPts: number } {
  const scores = game.finalScore?.team_card_points;
  const isPerSeat = game.variant === "BODENSEE_2P" || game.variant === "SOLO_4P";
  const myIdx = isPerSeat ? game.mySeat : game.myTeam;
  const ownPts = scores?.[myIdx] ?? 0;
  const oppPts = scores
    ? isPerSeat
      ? Math.max(0, ...scores.filter((_, i) => i !== game.mySeat))
      : (scores[1 - game.myTeam] ?? 0)
    : 0;
  return { ownPts, oppPts };
}

/** Ausgang eines Spiels (läuft/Sieg/Niederlage/Matsch). */
function gameResultKind(game: UserGameSummary, ownPts: number, oppPts: number): ResultKind {
  if (game.status !== "finished") return "running";
  // matsch_team trägt bei Kreuz den Team-Index, bei Bodensee/Solo den
  // Sitz-Index — in beiden Fällen vergleichbar mit `myIdx`.
  const isPerSeat = game.variant === "BODENSEE_2P" || game.variant === "SOLO_4P";
  const myIdx = isPerSeat ? game.mySeat : game.myTeam;
  const matschTeam = game.finalScore?.matsch_team;
  if (matschTeam === myIdx) return "matsch-won";
  if (matschTeam != null && matschTeam !== myIdx) return "matsch-lost";
  return ownPts > oppPts ? "won" : ownPts < oppPts ? "lost" : "draw";
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
