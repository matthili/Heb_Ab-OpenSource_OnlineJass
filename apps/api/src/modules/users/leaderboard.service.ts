/**
 * Globales Leaderboard (Opt-in, pro Variante).
 *
 * Spec: „Globales Leaderboard (Opt-in pro Nutzer)". Wir bauen die Liste auf
 * derselben Aggregations-Logik wie `UserStatsService.getStats`, aber:
 *   - nur User mit `Profile.publicLeaderboard = true`
 *   - pro Variante (Query-Parameter)
 *   - mindestens `MIN_GAMES`-Partien, damit ein 100%-Treffer mit einem
 *     einzigen Spiel nicht oben steht
 *   - sortiert nach Win-Rate DESC, Tiebreaker `gamesWon` DESC, dann `name` ASC
 *
 * Bewusst kein Caching: das Leaderboard ist nicht hochfrequent, und ein
 * frisches Spiel soll sofort die Position beeinflussen.
 */
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import { extractUserResult } from "./user-stats.service.js";

/** Untere Schranke an Partien, damit ein User ins Ranking kommt. */
export const MIN_GAMES_FOR_LEADERBOARD = 5;

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number; // 0..1
  avgOwnPoints: number;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(variant: string, limit: number): Promise<LeaderboardEntry[]> {
    // 1. Alle Sitze in beendeten Spielen der Variante, die zu opt-in-Usern
    //    gehören und nicht KI-ersetzt sind.
    const seats = await this.prisma.gameSeat.findMany({
      where: {
        replacedByAiSeatType: null,
        user: { profile: { publicLeaderboard: true } },
        game: { variant: variant as never, endedAt: { not: null } },
      },
      select: {
        seat: true,
        userId: true,
        user: { select: { name: true } },
        game: { select: { variant: true, finalScore: true } },
      },
    });

    // 2. Aggregat pro User.
    type Agg = {
      userId: string;
      name: string;
      gamesPlayed: number;
      gamesWon: number;
      totalPoints: number;
      pointGames: number;
    };
    const byUser = new Map<string, Agg>();
    for (const s of seats) {
      if (!s.userId || !s.user) continue;
      const agg =
        byUser.get(s.userId) ??
        ({
          userId: s.userId,
          name: s.user.name,
          gamesPlayed: 0,
          gamesWon: 0,
          totalPoints: 0,
          pointGames: 0,
        } satisfies Agg);
      agg.gamesPlayed += 1;
      const r = extractUserResult(s.game.variant, s.seat, s.game.finalScore);
      if (r.won === true) agg.gamesWon += 1;
      if (r.points !== null) {
        agg.totalPoints += r.points;
        agg.pointGames += 1;
      }
      byUser.set(s.userId, agg);
    }

    // 3. Threshold + Sort.
    const entries = [...byUser.values()]
      .filter((a) => a.gamesPlayed >= MIN_GAMES_FOR_LEADERBOARD)
      .map((a) => ({
        ...a,
        winRate: a.gamesWon / a.gamesPlayed,
        avgOwnPoints: a.pointGames > 0 ? a.totalPoints / a.pointGames : 0,
      }))
      .sort(
        (a, b) =>
          b.winRate - a.winRate || b.gamesWon - a.gamesWon || a.name.localeCompare(b.name, "de")
      )
      .slice(0, limit);

    return entries.map((a, idx) => ({
      rank: idx + 1,
      userId: a.userId,
      name: a.name,
      gamesPlayed: a.gamesPlayed,
      gamesWon: a.gamesWon,
      winRate: a.winRate,
      avgOwnPoints: a.avgOwnPoints,
    }));
  }
}
