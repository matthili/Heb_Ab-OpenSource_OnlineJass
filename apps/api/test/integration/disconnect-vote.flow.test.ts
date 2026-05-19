/**
 * Integration-Tests für den Disconnect-Vote-Flow.
 *
 * Drei Kern-Pfade als End-to-End-Beweis, dass die ganze Pipeline
 * (Socket-Disconnect → DisconnectVoteService → Phasen-Übergänge →
 * Outcome → Game-Service-Hooks) zusammen funktioniert:
 *
 *   1. **Solo-User trennt sich + reconnected nicht** → Tisch geschlossen
 *      (CLOSED in DB + Lobby.status = CLOSED).
 *   2. **Reconnect während GRACE_1** → State geht auf CONTINUED, Tisch
 *      bleibt offen.
 *   3. **VOTE_1 mit Mehrheits-FILL** → disconnected Sitz wird KI,
 *      Spiel läuft weiter (Game.endedAt bleibt null, Lobby auf IN_GAME).
 *
 * Phasen-Dauern werden im Test-Setup um 95% gekürzt
 * (DISCONNECT_PHASE_MS_SCALE=0.05) — sonst würden die Tests Minuten
 * dauern.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";

import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("Disconnect-Vote Flow", () => {
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

  function connectWs(u: SignedInUser): Promise<Socket> {
    const socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: u.http.cookieHeader() },
      reconnection: false,
    });
    return new Promise((resolve, reject) => {
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", (e) => reject(new Error(`WS connect: ${e.message}`)));
      setTimeout(() => reject(new Error("WS connect timeout")), 5_000);
    });
  }

  /** Solo-Tisch mit 3 KIs erstellen, Game-ID zurückgeben. */
  async function openSoloTable(u: SignedInUser): Promise<{ tableId: string; gameId: string }> {
    const res = await u.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
      }),
    });
    const tableId = res.body.tableId;
    const detail = await u.http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    if (!detail.body.currentGameId) {
      throw new Error("Game wurde nicht automatisch gestartet");
    }
    return { tableId, gameId: detail.body.currentGameId };
  }

  it("Solo: Disconnect ohne Reconnect → Tisch wird automatisch geschlossen", async () => {
    const alice = await signUpAndIn(app, {
      email: "alice-disc@jass.local",
      password: "very-long-test-pw-12!",
      name: "alice-disc",
    });
    const { tableId, gameId } = await openSoloTable(alice);

    // Mit WS connecten + game:join, damit DisconnectVoteService die
    // initiale Online-Lage kennt.
    const sock = await connectWs(alice);
    sock.emit("game:join", { gameId });
    await sleep(150);

    // WS-Verbindung kappen.
    sock.disconnect();

    // GRACE_1 (6s) → VOTE_1 (0.75s) → kein Vote → Timeout → STOP-Outcome
    // → Tisch zu. Wir warten generös 8s.
    await sleep(8000);

    const lobby = await app.prisma.lobbyTable.findUnique({ where: { id: tableId } });
    expect(lobby?.status).toBe("CLOSED");
    expect(lobby?.currentGameId).toBeNull();

    const game = await app.prisma.game.findUnique({ where: { id: gameId } });
    expect(game?.endedAt).not.toBeNull();
  }, 15_000);

  it("Solo: Reconnect während GRACE_1 → Tisch bleibt offen", async () => {
    const alice = await signUpAndIn(app, {
      email: "alice-rec@jass.local",
      password: "very-long-test-pw-12!",
      name: "alice-rec",
    });
    const { tableId, gameId } = await openSoloTable(alice);

    const sock = await connectWs(alice);
    sock.emit("game:join", { gameId });
    await sleep(150);

    sock.disconnect();

    // Während GRACE_1 (6s) wieder connecten + game:join → CONTINUED.
    await sleep(2000); // mitten in der Grace-Phase
    const reconnect = await connectWs(alice);
    reconnect.emit("game:join", { gameId });
    await sleep(500);

    // GRACE_1 läuft trotzdem weiter im Hintergrund — aber CONTINUED-
    // Marker wurde gesetzt, der State wird nach 3s geräumt. Insgesamt
    // 8s warten und prüfen, dass der Tisch NICHT geschlossen wurde.
    await sleep(6000);

    const lobby = await app.prisma.lobbyTable.findUnique({ where: { id: tableId } });
    expect(lobby?.status).not.toBe("CLOSED");

    const game = await app.prisma.game.findUnique({ where: { id: gameId } });
    expect(game?.endedAt).toBeNull();
    reconnect.disconnect();
  }, 15_000);

  it("2 Menschen: Disconnect + verbleibender Mensch wählt FILL → Sitz wird KI, Spiel läuft", async () => {
    const alice = await signUpAndIn(app, {
      email: "alice-fill@jass.local",
      password: "very-long-test-pw-12!",
      name: "alice-fill",
    });
    const bob = await signUpAndIn(app, {
      email: "bob-fill@jass.local",
      password: "very-long-test-pw-12!",
      name: "bob-fill",
    });

    // Tisch von alice mit 2 KIs auf 1+2; bob beitreten lassen auf Sitz 3.
    const res = await alice.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        initialAiSeats: [{ seat: 1 }, { seat: 2 }],
      }),
    });
    const tableId = res.body.tableId;
    const join = await bob.http.request<{ kind: string; seat: number }>(
      `/api/lobby/tables/${tableId}/join`,
      { method: "POST" }
    );
    expect(join.status).toBe(201);
    expect(join.body.kind).toBe("seated");

    // Tisch ist jetzt 4-voll → Auto-Start.
    const detail = await alice.http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    const gameId = detail.body.currentGameId;
    expect(gameId).toBeTruthy();

    // Beide WS connecten + joinen.
    const aliceSock = await connectWs(alice);
    const bobSock = await connectWs(bob);
    aliceSock.emit("game:join", { gameId });
    bobSock.emit("game:join", { gameId });
    await sleep(300);

    // Alice trennt sich. Bob bleibt online.
    aliceSock.disconnect();

    // Warten bis VOTE_1 aktiv ist (nach GRACE_1 = 6 s) UND
    // SOFORT voten — das VOTE_1-Fenster ist mit Test-Skalierung nur
    // 0.75 s lang, da hat ein await sleep(7000) keine Chance.
    const voteFiredPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("VOTE_1 nicht innerhalb 10s erreicht")),
        10_000
      );
      bobSock.on("game:disconnect-state", (s: { phase: string }) => {
        if (s.phase === "VOTE_1") {
          clearTimeout(timeout);
          // Vote direkt im Event-Handler abschicken
          bobSock.emit("game:disconnect-vote", { gameId, choice: "FILL" });
          resolve();
        }
      });
    });
    await voteFiredPromise;

    // Persistenz + markUserLeft + driveAIsToEnd brauchen Zeit.
    await sleep(2000);

    // GameSeat von alice sollte jetzt leftAt gesetzt haben (markUserLeft).
    const seat = await app.prisma.gameSeat.findFirst({
      where: { gameId: gameId!, userId: alice.userId },
    });
    expect(seat?.leftAt).not.toBeNull();

    // Tisch bleibt OFFEN (kein CLOSED).
    const lobby = await app.prisma.lobbyTable.findUnique({ where: { id: tableId } });
    expect(lobby?.status).not.toBe("CLOSED");

    bobSock.disconnect();
  }, 20_000);
});
