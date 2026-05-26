/**
 * Integration-Test: globales Leaderboard (Opt-in).
 *
 * Szenarien:
 *   1. Endpunkt ist ohne Login erreichbar.
 *   2. Nur User mit `Profile.publicLeaderboard=true` erscheinen.
 *   3. User mit weniger als MIN_GAMES Partien werden ausgeschlossen.
 *   4. Sortierung nach Win-Rate desc, Tiebreaker `gamesWon` desc.
 *   5. Falsche Variante → 400 (Zod-Schema).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createHttpClient } from "./http-client.js";
import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

interface LbResponse {
  variant: string;
  entries: Array<{
    rank: number;
    name: string;
    gamesPlayed: number;
    gamesWon: number;
    winRate: number;
  }>;
}

describe("Leaderboard (Opt-in)", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  it("Ranking: zwei Opt-in-User, Win-Rate-Sortierung, Mindest-Partien-Cut", async () => {
    // Alice: 5 KREUZ_4P-Spiele, 4 gewonnen (80%).
    const alice = await signUpAndIn(app, {
      email: "lb-alice@jass.local",
      password: "lb-alice-passw0rd-12!",
      name: "lb_alice",
    });
    // Bob: 5 KREUZ_4P-Spiele, 5 gewonnen (100%) — sollte oben stehen.
    const bob = await signUpAndIn(app, {
      email: "lb-bob@jass.local",
      password: "lb-bob-passw0rd-12!",
      name: "lb_bob",
    });
    // Carol: 4 Spiele, 4 gewonnen — UNTER MIN_GAMES (5), darf NICHT auftauchen.
    const carol = await signUpAndIn(app, {
      email: "lb-carol@jass.local",
      password: "lb-carol-passw0rd-12!",
      name: "lb_carol",
    });
    // Dave: 5 Spiele, 5 gewonnen — aber publicLeaderboard=false → unsichtbar.
    const dave = await signUpAndIn(app, {
      email: "lb-dave@jass.local",
      password: "lb-dave-passw0rd-12!",
      name: "lb_dave",
    });

    // Profile-Opt-in setzen (außer Dave).
    for (const u of [alice, bob, carol]) {
      await u.http.request("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ publicLeaderboard: true }),
      });
    }

    // Helper: lege ein beendetes KREUZ_4P-Spiel mit dem User auf Sitz 0
    // und gegebenem Team-Score an.
    async function makeGame(userId: string, won: boolean): Promise<void> {
      const game = await app.prisma.game.create({
        data: {
          variant: "KREUZ_4P",
          ruleVersion: "1.2.0",
          endedAt: new Date(),
          finalScore: { team_card_points: won ? [100, 57] : [57, 100] },
        },
      });
      await app.prisma.gameSeat.create({
        data: { gameId: game.id, seat: 0, userId },
      });
    }

    // Alice: 4 Siege + 1 Niederlage.
    for (let i = 0; i < 4; i++) await makeGame(alice.userId, true);
    await makeGame(alice.userId, false);
    // Bob: 5 Siege.
    for (let i = 0; i < 5; i++) await makeGame(bob.userId, true);
    // Carol: 4 Siege (zu wenig).
    for (let i = 0; i < 4; i++) await makeGame(carol.userId, true);
    // Dave: 5 Siege (aber kein Opt-in).
    for (let i = 0; i < 5; i++) await makeGame(dave.userId, true);

    const anon = createHttpClient(app.baseUrl);
    const r = await anon.request<LbResponse>("/api/leaderboard?variant=KREUZ_4P", {
      method: "GET",
    });
    expect(r.status).toBe(200);
    expect(r.body.variant).toBe("KREUZ_4P");

    // Erwartung: Bob (100%) auf Rang 1, Alice (80%) auf Rang 2.
    // Carol fehlt (zu wenig Spiele), Dave fehlt (kein Opt-in).
    expect(r.body.entries.map((e) => e.name)).toEqual(["lb_bob", "lb_alice"]);
    expect(r.body.entries[0]?.rank).toBe(1);
    expect(r.body.entries[0]?.gamesPlayed).toBe(5);
    expect(r.body.entries[0]?.gamesWon).toBe(5);
    expect(r.body.entries[0]?.winRate).toBe(1);
    expect(r.body.entries[1]?.rank).toBe(2);
    expect(r.body.entries[1]?.winRate).toBeCloseTo(0.8, 5);
  });

  it("falsche Variante → 400", async () => {
    const anon = createHttpClient(app.baseUrl);
    const r = await anon.request("/api/leaderboard?variant=PINGPONG", { method: "GET" });
    expect(r.status).toBe(400);
  });

  it("keine Opt-in-User → leere Liste, aber kein Fehler", async () => {
    const anon = createHttpClient(app.baseUrl);
    const r = await anon.request<LbResponse>("/api/leaderboard?variant=BODENSEE_2P", {
      method: "GET",
    });
    expect(r.status).toBe(200);
    expect(r.body.entries).toHaveLength(0);
  });
});
