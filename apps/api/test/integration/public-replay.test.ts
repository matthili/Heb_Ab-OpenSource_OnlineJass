/**
 * Integration-Test: öffentliche/teilbare Replays.
 *
 * Szenarien:
 *   1. Neues Game ist standardmäßig NICHT öffentlich → /public liefert 404.
 *   2. Teilnehmer kann das Flag umschalten (PATCH) → /public liefert das
 *      vollständige Replay-Bundle ohne Auth.
 *   3. Nicht-Teilnehmer bekommt 403 beim Toggle.
 *   4. /public-Endpunkt ist via ohne-Session-Client erreichbar, wenn das
 *      Flag gesetzt ist.
 *   5. Zurückschalten auf `isPublic: false` lässt das /public-Endpunkt
 *      wieder 404 liefern.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createHttpClient } from "./http-client.js";
import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("Öffentliche Replays", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  it("ist standardmäßig privat; Teilnehmer kann es veröffentlichen und der Public-Endpunkt liefert", async () => {
    const player = await signUpAndIn(app, {
      email: "replay-pub@jass.local",
      password: "replay-pub-passw0rd-12!",
      name: "replay_pub",
    });

    // Game + Sitz direkt anlegen (kein echter Spielablauf nötig).
    const game = await app.prisma.game.create({
      data: {
        variant: "KREUZ_4P",
        ruleVersion: "1.2.0",
        endedAt: new Date(),
        finalScore: { team_card_points: [100, 57] },
      },
    });
    await app.prisma.gameSeat.create({
      data: { gameId: game.id, seat: 0, userId: player.userId },
    });

    // 1) /public liefert 404 (privat).
    const anon = createHttpClient(app.baseUrl);
    const privateGet = await anon.request(`/api/games/${game.id}/replay/public`, {
      method: "GET",
    });
    expect(privateGet.status).toBe(404);

    // 2) Teilnehmer schaltet auf öffentlich.
    const toggle = await player.http.request<{ publicReplay: boolean }>(
      `/api/games/${game.id}/replay/visibility`,
      { method: "PATCH", body: JSON.stringify({ isPublic: true }) }
    );
    expect(toggle.status).toBeLessThan(300);
    expect(toggle.body.publicReplay).toBe(true);

    // 3) /public liefert jetzt das Bundle, auch ohne Session.
    const pub = await anon.request<{ publicReplay: boolean; seats: unknown[] }>(
      `/api/games/${game.id}/replay/public`,
      { method: "GET" }
    );
    expect(pub.status).toBe(200);
    expect(pub.body.publicReplay).toBe(true);
    expect(pub.body.seats).toHaveLength(1);

    // 4) Zurück auf privat → wieder 404.
    await player.http.request(`/api/games/${game.id}/replay/visibility`, {
      method: "PATCH",
      body: JSON.stringify({ isPublic: false }),
    });
    const closedAgain = await anon.request(`/api/games/${game.id}/replay/public`, {
      method: "GET",
    });
    expect(closedAgain.status).toBe(404);
  });

  it("Nicht-Teilnehmer kann das Flag nicht setzen (403)", async () => {
    const player = await signUpAndIn(app, {
      email: "replay-pub2-host@jass.local",
      password: "replay-pub2-host-passw0rd-12!",
      name: "replay_pub2_host",
    });
    const stranger = await signUpAndIn(app, {
      email: "replay-pub2-stranger@jass.local",
      password: "replay-pub2-stranger-passw0rd-12!",
      name: "replay_pub2_stranger",
    });
    const game = await app.prisma.game.create({
      data: { variant: "BODENSEE_2P", ruleVersion: "1.2.0" },
    });
    await app.prisma.gameSeat.create({
      data: { gameId: game.id, seat: 0, userId: player.userId },
    });

    const reject = await stranger.http.request(`/api/games/${game.id}/replay/visibility`, {
      method: "PATCH",
      body: JSON.stringify({ isPublic: true }),
    });
    expect(reject.status).toBe(403);
  });

  it("nicht existierendes Game → /public liefert 404 ohne Existenz-Leak", async () => {
    const anon = createHttpClient(app.baseUrl);
    const r = await anon.request("/api/games/does-not-exist/replay/public", { method: "GET" });
    expect(r.status).toBe(404);
  });
});
