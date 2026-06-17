/**
 * Integration-Test: Bodensee-Jass mit ZWEI Menschen — einer trennt die
 * Verbindung (Fenster zu) und kommt nicht zurück.
 *
 * Reproduziert den vom User gemeldeten Fall: „Gegner schließt den Tab/das
 * Fenster — beim Verbliebenen passiert nichts." Erwartet:
 *   1. 2. Mensch tritt bei → Tisch 2-voll → Auto-Start (currentGameId gesetzt)
 *   2. Die Disconnect-Query (`getActiveGameIdsForUser`-Äquivalent) findet das
 *      laufende Game für beide Spieler  ← Sanity, schlägt zuerst an, falls die
 *      Persistenz/Query der eigentliche Defekt ist
 *   3. Trennt B die WS-Verbindung, übernimmt nach der (skalierten) Schonfrist
 *      die KI und der verbleibende Spieler A bekommt `bodensee:opponent-left`
 *      mit `reason: "timeout"` und dem echten Namen.
 *
 * Grace ist im Test via DISCONNECT_PHASE_MS_SCALE=0.05 auf 30 s × 0.05 = 1,5 s
 * gestaucht.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function connectP(s: Socket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    s.once("connect", () => resolve());
    s.once("connect_error", (e) => reject(new Error(`WS connect_error: ${e.message}`)));
    setTimeout(() => reject(new Error("WS connect timeout (5s)")), 5_000);
  });
}

describe("Bodensee-ws — 2 Menschen, einer trennt die Verbindung", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  it("Disconnect des Gegners → nach Grace KI-Übernahme + bodensee:opponent-left (reason timeout)", async () => {
    const a = await signUpAndIn(app, {
      email: "bo-dc-a@jass.local",
      password: "bo-dc-passw0rd-12!",
      name: "Anna",
    });
    const b = await signUpAndIn(app, {
      email: "bo-dc-b@jass.local",
      password: "bo-dc-passw0rd-12!",
      name: "Bert",
    });

    // ─── A öffnet einen 2-Mensch-Bodensee-Tisch (kein initial AI) ───────
    const create = await a.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN", variant: "BODENSEE_2P", aiSeatType: "random" }),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const tableId = create.body.tableId;

    // ─── B tritt bei → 2-voll → Auto-Start ─────────────────────────────
    const join = await b.http.request<unknown>(`/api/lobby/tables/${tableId}/join`, {
      method: "POST",
    });
    expect([200, 201], JSON.stringify(join.body)).toContain(join.status);

    const detail = await a.http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    const gameId = detail.body.currentGameId;
    expect(gameId, "Spiel sollte nach dem 2. Menschen auto-starten").not.toBeNull();

    // ─── Sanity: findet die Disconnect-Query das laufende Game? ─────────
    // Exakt die Bedingung aus BodenseeGameService.getActiveGameIdsForUser.
    const activeForB = await app.prisma.gameSeat.findMany({
      where: {
        userId: b.userId,
        replacedByAiSeatType: null,
        game: { variant: "BODENSEE_2P", endedAt: null },
      },
      select: { gameId: true },
    });
    expect(
      activeForB.map((s) => s.gameId),
      "Disconnect-Query muss das laufende Bodensee-Game für B finden"
    ).toContain(gameId);

    // ─── Beide via WS verbinden + joinen ────────────────────────────────
    const sockA: Socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: a.http.cookieHeader() },
      reconnection: false,
    });
    const sockB: Socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: b.http.cookieHeader() },
      reconnection: false,
    });

    let oppLeft: { name?: string | null; reason?: string } | null = null;
    sockA.on("bodensee:opponent-left", (p: { name?: string | null; reason?: string }) => {
      oppLeft = p;
    });

    await Promise.all([connectP(sockA), connectP(sockB)]);
    sockA.emit("bodensee:join", { gameId });
    sockB.emit("bodensee:join", { gameId });
    await sleep(300); // Join + Room-Mitgliedschaft sich setzen lassen

    // ─── B trennt die Verbindung („Fenster zu") ─────────────────────────
    sockB.disconnect();

    // Grace = 30 s × 0.05 = 1,5 s → spätestens nach ~8 s muss das Event da sein.
    const deadline = Date.now() + 8_000;
    while (!oppLeft && Date.now() < deadline) await sleep(50);

    expect(oppLeft, "kein bodensee:opponent-left beim Verbliebenen angekommen").not.toBeNull();
    expect(oppLeft!.reason).toBe("timeout");
    expect(oppLeft!.name).toBe("Bert");

    sockA.disconnect();
  }, 20_000);
});
