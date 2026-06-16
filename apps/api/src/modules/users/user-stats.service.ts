/**
 * Basis-Spiel-Statistiken pro User und Spielvariante.
 *
 * Aggregiert ueber alle beendeten Games, in denen der User echt mitgespielt
 * hat (`replacedByAiSeatType IS NULL` → von Anfang bis Ende). Liefert:
 *   - gamesPlayed pro Variante
 *   - gamesWon   pro Variante (siehe Win-Logik unten)
 *   - winRate    = gamesWon / gamesPlayed
 *   - avgOwnPoints aus `Game.finalScore` (Variante-spezifisches Layout)
 *
 * **Win-Logik pro Variante**:
 *   - KREUZ_4P / KREUZ_6P: Team-Score (`team_card_points`, Team = seat % 2)
 *     ist strikt höher als das gegnerische Team → gewonnen.
 *   - SOLO_4P: jeder Sitz ist sein eigenes Team in `team_card_points` (Index =
 *     Sitz). User hat gewonnen, wenn sein Score der höchste ist (≥ Max).
 *   - BODENSEE_2P: zwei Einzelspieler in `player_total_points`. Höher = Sieg.
 *
 * Bei Gleichstand zählt das Spiel für Team-Varianten als „nicht gewonnen", für
 * Einzel-Varianten (Solo / Bodensee) als „mit-gewonnen" (≥ Max).
 */
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

export interface VariantStat {
  variant: string;
  gamesPlayed: number;
  gamesWon: number;
  /** Anteil 0..1 — der Caller formatiert auf Prozent. */
  winRate: number;
  /** Avg Punkte pro Spiel — über die Spiele, für die wir Punkte extrahieren konnten. */
  avgOwnPoints: number;
}

export interface UserStats {
  perVariant: VariantStat[];
  totals: { gamesPlayed: number; gamesWon: number };
}

interface UserGameResult {
  /** Eigene Punkte aus diesem Spiel — null wenn nicht extrahierbar. */
  points: number | null;
  /** Hat der User gewonnen? null wenn nicht ermittelbar. */
  won: boolean | null;
}

@Injectable()
export class UserStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(userId: string): Promise<UserStats> {
    const seats = await this.prisma.gameSeat.findMany({
      where: {
        userId,
        replacedByAiSeatType: null,
        game: { endedAt: { not: null } },
      },
      select: {
        seat: true,
        game: { select: { variant: true, finalScore: true } },
      },
    });

    type Agg = { gamesPlayed: number; gamesWon: number; totalPoints: number; pointGames: number };
    const byVariant = new Map<string, Agg>();

    for (const s of seats) {
      const v = s.game.variant;
      const agg = byVariant.get(v) ?? {
        gamesPlayed: 0,
        gamesWon: 0,
        totalPoints: 0,
        pointGames: 0,
      };
      agg.gamesPlayed += 1;
      const r = extractUserResult(v, s.seat, s.game.finalScore);
      if (r.won === true) agg.gamesWon += 1;
      if (r.points !== null) {
        agg.totalPoints += r.points;
        agg.pointGames += 1;
      }
      byVariant.set(v, agg);
    }

    const perVariant: VariantStat[] = [...byVariant.entries()].map(([variant, a]) => ({
      variant,
      gamesPlayed: a.gamesPlayed,
      gamesWon: a.gamesWon,
      winRate: a.gamesPlayed > 0 ? a.gamesWon / a.gamesPlayed : 0,
      avgOwnPoints: a.pointGames > 0 ? a.totalPoints / a.pointGames : 0,
    }));
    // Stabile Reihenfolge (alphabetisch nach Variant-Enum) — der Client kann
    // sich darauf verlassen, wenn er die Tabelle rendert.
    perVariant.sort((a, b) => a.variant.localeCompare(b.variant));

    const totals = perVariant.reduce(
      (acc, v) => ({
        gamesPlayed: acc.gamesPlayed + v.gamesPlayed,
        gamesWon: acc.gamesWon + v.gamesWon,
      }),
      { gamesPlayed: 0, gamesWon: 0 }
    );

    return { perVariant, totals };
  }
}

/**
 * Reine Extraktion aus `finalScore` — exportiert für Unit-Tests.
 * Defensive Implementation: alles bricht zu `null`/`null` ab, wenn die
 * Variante unbekannt oder der Blob nicht das erwartete Layout hat. So
 * crashed der Aggregator nie wegen fremder/alter Daten.
 */
export function extractUserResult(
  variant: string,
  seat: number,
  finalScore: unknown
): UserGameResult {
  if (!finalScore || typeof finalScore !== "object") return { points: null, won: null };
  const fs = finalScore as Record<string, unknown>;

  if (variant === "BODENSEE_2P") {
    // Bodensee persistiert die Spieler-Punkte unter `team_card_points`
    // (siehe bodensee-game.service handleGameEnd) — NICHT `player_total_points`.
    // Vorher las dieser Zweig einen nie geschriebenen Key → Stats + Leaderboard
    // für Bodensee waren immer leer. (Audit-Fund, behoben.)
    const arr = toNumberArray(fs["team_card_points"]);
    if (!arr || seat < 0 || seat >= arr.length) return { points: null, won: null };
    const me = arr[seat]!;
    const max = Math.max(...arr);
    return { points: me, won: me >= max };
  }

  if (variant === "SOLO_4P") {
    const arr = toNumberArray(fs["team_card_points"]);
    if (!arr || seat < 0 || seat >= arr.length) return { points: null, won: null };
    const me = arr[seat]!;
    const max = Math.max(...arr);
    return { points: me, won: me >= max };
  }

  if (variant === "KREUZ_4P" || variant === "KREUZ_6P") {
    const arr = toNumberArray(fs["team_card_points"]);
    if (!arr) return { points: null, won: null };
    const team = seat % 2;
    const me = arr[team];
    const other = arr[1 - team];
    if (typeof me !== "number" || typeof other !== "number") return { points: null, won: null };
    return { points: me, won: me > other };
  }

  return { points: null, won: null };
}

function toNumberArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}
