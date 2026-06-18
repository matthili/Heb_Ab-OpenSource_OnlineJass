/**
 * Integration-Test: `GET /api/users/me/stats` (Basis-Spiel-Statistiken).
 *
 * Wir bauen direkt über Prisma drei Games + GameSeats für einen User
 * (KREUZ_4P-Sieg, SOLO_4P-Niederlage, BODENSEE_2P-Sieg) und prüfen, dass
 * die aggregierten Werte stimmen. Ein viertes Game ist im laufenden Status
 * (kein `endedAt`) und darf NICHT mitgezählt werden — robustness gegen den
 * Aktiv-vs.-Beendet-Filter.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("UserStats `/api/users/me/stats`", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  it("aggregiert Partien/Siege/Win-Rate/Avg über drei Varianten", async () => {
    const { http, userId } = await signUpAndIn(app, {
      email: "stats@jass.local",
      password: "stats-passw0rd-12!",
      name: "stats_user",
    });

    // 1) KREUZ_4P, Sitz 0 (Team 0) gewinnt 100:57 → Punkte 100, won.
    const g1 = await app.prisma.game.create({
      data: {
        variant: "KREUZ_4P",
        ruleVersion: "1.2.0",
        startedAt: new Date("2026-05-20T10:00:00Z"),
        endedAt: new Date("2026-05-20T10:30:00Z"),
        finalScore: { team_card_points: [100, 57] },
      },
    });
    await app.prisma.gameSeat.create({
      data: { gameId: g1.id, seat: 0, userId },
    });

    // 2) SOLO_4P, Sitz 1 hat 50 — Max ist 90 (Sitz 2). User verliert.
    const g2 = await app.prisma.game.create({
      data: {
        variant: "SOLO_4P",
        ruleVersion: "1.2.0",
        startedAt: new Date("2026-05-20T11:00:00Z"),
        endedAt: new Date("2026-05-20T11:30:00Z"),
        finalScore: { team_card_points: [40, 50, 90, 60] },
      },
    });
    await app.prisma.gameSeat.create({
      data: { gameId: g2.id, seat: 1, userId },
    });

    // 3) BODENSEE_2P, Sitz 0 gewinnt 80:77.
    const g3 = await app.prisma.game.create({
      data: {
        variant: "BODENSEE_2P",
        ruleVersion: "1.2.0",
        startedAt: new Date("2026-05-20T12:00:00Z"),
        endedAt: new Date("2026-05-20T12:20:00Z"),
        // Bodensee persistiert die Spieler-Punkte in der DB unter
        // `team_card_points` (siehe bodensee-game.service handleGameEnd) — NICHT
        // `player_total_points` (das ist nur der Live-View-Key). Der Stats-Service
        // liest entsprechend `team_card_points`; der Test muss das spiegeln.
        finalScore: { team_card_points: [80, 77] },
      },
    });
    await app.prisma.gameSeat.create({
      data: { gameId: g3.id, seat: 0, userId },
    });

    // 4) Laufendes Spiel — endedAt = null. Darf NICHT zählen.
    const g4 = await app.prisma.game.create({
      data: {
        variant: "KREUZ_4P",
        ruleVersion: "1.2.0",
        startedAt: new Date(),
      },
    });
    await app.prisma.gameSeat.create({
      data: { gameId: g4.id, seat: 0, userId },
    });

    // 5) Ausgestiegen mitten im Spiel — replacedByAiSeatType gesetzt → nicht zählen.
    const g5 = await app.prisma.game.create({
      data: {
        variant: "KREUZ_4P",
        ruleVersion: "1.2.0",
        startedAt: new Date("2026-05-20T13:00:00Z"),
        endedAt: new Date("2026-05-20T13:25:00Z"),
        finalScore: { team_card_points: [120, 37] },
      },
    });
    await app.prisma.gameSeat.create({
      data: {
        gameId: g5.id,
        seat: 0,
        userId,
        replacedByAiSeatType: "heuristic",
        leftAt: new Date("2026-05-20T13:10:00Z"),
      },
    });

    const r = await http.request<{
      perVariant: Array<{
        variant: string;
        gamesPlayed: number;
        gamesWon: number;
        winRate: number;
        avgOwnPoints: number;
      }>;
      totals: { gamesPlayed: number; gamesWon: number };
    }>("/api/users/me/stats", { method: "GET" });

    expect(r.status).toBe(200);

    const byVariant = Object.fromEntries(r.body.perVariant.map((v) => [v.variant, v]));
    expect(byVariant["KREUZ_4P"]).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 1,
      avgOwnPoints: 100,
    });
    expect(byVariant["KREUZ_4P"]!.winRate).toBe(1);

    expect(byVariant["SOLO_4P"]).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 0,
      avgOwnPoints: 50,
    });
    expect(byVariant["SOLO_4P"]!.winRate).toBe(0);

    expect(byVariant["BODENSEE_2P"]).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 1,
      avgOwnPoints: 80,
    });

    expect(r.body.totals.gamesPlayed).toBe(3);
    expect(r.body.totals.gamesWon).toBe(2);
  });

  it("ohne Spiele: leere `perVariant`, totals=0", async () => {
    const { http } = await signUpAndIn(app, {
      email: "stats-empty@jass.local",
      password: "stats-empty-passw0rd-12!",
      name: "stats_empty",
    });
    const r = await http.request<{
      perVariant: unknown[];
      totals: { gamesPlayed: number; gamesWon: number };
    }>("/api/users/me/stats", { method: "GET" });
    expect(r.status).toBe(200);
    expect(r.body.perVariant).toHaveLength(0);
    expect(r.body.totals).toEqual({ gamesPlayed: 0, gamesWon: 0 });
  });

  it("ohne Login → 401", async () => {
    // Ein leerer Cookie-Client: erstellt manuell ohne `signUpAndIn`.
    const { createHttpClient } = await import("./http-client.js");
    const http = createHttpClient(app.baseUrl);
    const r = await http.request("/api/users/me/stats", { method: "GET" });
    expect([401, 403]).toContain(r.status);
  });
});
