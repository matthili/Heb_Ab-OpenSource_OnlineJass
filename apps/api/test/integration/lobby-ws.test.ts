/**
 * Integration-Test: M6-F WebSocket-Pushes für Lobby + Re-Match.
 *
 * Statt jeden einzelnen Event-Pfad zu testen (es sind ~10), prüfen wir die
 * vier strukturell unterschiedlichen Push-Arten:
 *   1. `lobby:tables-updated` an Lobby-Liste-Abonnenten (broadcast)
 *   2. `lobby:table-state` an Tisch-Abonnenten (broadcast)
 *   3. `lobby:invite-received` an User-Kanal (gezielter Push)
 *   4. `game:rematch-decided` an Tisch-Abonnenten (broadcast, mit Outcome)
 *
 * Wenn diese vier Pfade funktionieren, ist die Push-Infrastruktur intakt
 * und die anderen Events sind nur Konfig-Varianten desselben Patterns.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";

import { settleAnnouncement } from "./announce-helper.js";
import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("M6-F lobby WS pushes", () => {
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

  async function makeUsers(n: number): Promise<SignedInUser[]> {
    const users: SignedInUser[] = [];
    for (let i = 0; i < n; i++) {
      users.push(
        await signUpAndIn(app, {
          email: `ws${i}@jass.local`,
          password: "ws-pw-12-chars-ok!",
          name: `ws${i}`,
        })
      );
    }
    return users;
  }

  function connect(user: SignedInUser): Promise<Socket> {
    const socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: user.http.cookieHeader() },
      reconnection: false,
    });
    return new Promise((resolve, reject) => {
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", (e) => reject(new Error(`WS connect: ${e.message}`)));
      setTimeout(() => reject(new Error("WS connect timeout")), 5_000);
    });
  }

  /** Promise, das bei nächstem Event mit gegebenem Namen resolved. */
  function nextEvent<T = unknown>(socket: Socket, name: string, timeoutMs = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout waiting for "${name}"`)), timeoutMs);
      socket.once(name, (payload: T) => {
        clearTimeout(t);
        resolve(payload);
      });
    });
  }

  it("Tisch-Open broadcastet `lobby:tables-updated` an Listen-Abonnenten", async () => {
    const [owner, observer] = await makeUsers(2);
    const obsSocket = await connect(observer!);
    await obsSocket.emitWithAck("lobby:subscribe-list");

    const updatePromise = nextEvent<{ reason: string; tableId: string }>(
      obsSocket,
      "lobby:tables-updated"
    );

    await owner!.http.request("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN" }),
    });

    const evt = await updatePromise;
    expect(evt.reason).toBe("table-opened");
    expect(evt.tableId).toBeTruthy();
    obsSocket.disconnect();
  });

  it("`lobby:table-state` geht an Tisch-Abonnenten beim Sitz-Wechsel", async () => {
    const [owner, joiner, observer] = await makeUsers(3);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN" }),
    });
    const tableId = created.body.tableId;

    const obsSocket = await connect(observer!);
    await obsSocket.emitWithAck("lobby:subscribe-table", { tableId });

    // Vorher Pushes konsumieren, die aus openTable kommen (table-state +
    // tables-updated waren VOR der Subscription, fließen also nicht zu uns).
    const statePromise = nextEvent<{ id: string; seatsTaken: number }>(
      obsSocket,
      "lobby:table-state"
    );

    await joiner!.http.request(`/api/lobby/tables/${tableId}/join`, { method: "POST" });

    const view = await statePromise;
    expect(view.id).toBe(tableId);
    expect(view.seatsTaken).toBe(2);
    obsSocket.disconnect();
  });

  it("`lobby:invite-received` landet gezielt im persönlichen Kanal des Eingeladenen", async () => {
    const [owner, invitee] = await makeUsers(2);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "INVITE" }),
    });
    const tableId = created.body.tableId;

    // Invitee verbindet sich — der LobbyGateway joint ihn automatisch
    // seinem persönlichen Kanal `lobby:user:<id>`.
    const inviteeSocket = await connect(invitee!);

    const invitePromise = nextEvent<{ inviteId: string; tableId: string }>(
      inviteeSocket,
      "lobby:invite-received"
    );

    await owner!.http.request(`/api/lobby/tables/${tableId}/invites`, {
      method: "POST",
      body: JSON.stringify({ inviteeUserId: invitee!.userId }),
    });

    const evt = await invitePromise;
    expect(evt.tableId).toBe(tableId);
    expect(evt.inviteId).toBeTruthy();
    inviteeSocket.disconnect();
  });

  it("`game:rematch-decided` broadcasted nach abgeschlossenem Vote", async () => {
    const [owner] = await makeUsers(1);
    const ownerSocket = await connect(owner!);

    // Solo-User + 3 KIs aufmachen → Auto-Start.
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        aiSeatType: "random",
        restartMode: "SIEGER_GIBT",
        initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
      }),
    });
    const tableId = created.body.tableId;
    await ownerSocket.emitWithAck("lobby:subscribe-table", { tableId });

    // Komplettes Game durchspielen.
    const detail = await owner!.http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    const gameId = detail.body.currentGameId!;
    // Sprint C: Ansage-Phase abwickeln, bevor Karten gespielt werden.
    await settleAnnouncement(app, gameId);
    for (let i = 0; i < 50; i++) {
      const next = await app.games.nextAISeat(gameId);
      if (next) {
        const card = await app.games.aiChooseMove(gameId, next.seat, next.aiSeatType);
        await app.games.playMoveAsSeat(gameId, next.seat, card);
        continue;
      }
      const view = await app.games.viewForSeat(gameId, 0);
      if (view.status === "finished") break;
      const handCard = view.hand.find(
        (c) =>
          view.legalActionMask[
            ["EICHEL", "SCHELLE", "HERZ", "LAUB"].indexOf(c.suit) * 9 +
              ["SECHS", "SIEBEN", "ACHT", "NEUN", "ZEHN", "UNTER", "OBER", "KOENIG", "ASS"].indexOf(
                c.rank
              )
          ] === 1
      )!;
      await app.games.playMoveAsSeat(gameId, 0, handCard);
    }

    // Re-Match-Vote → soll `game:rematch-decided` triggern.
    const decidedPromise = nextEvent<{ kind: string; starter?: number }>(
      ownerSocket,
      "game:rematch-decided",
      5_000
    );

    await owner!.http.request(`/api/games/${gameId}/rematch-vote`, {
      method: "POST",
      body: JSON.stringify({ vote: "YES" }),
    });

    const evt = await decidedPromise;
    expect(evt.kind).toBe("rematch-started");
    expect(typeof evt.starter).toBe("number");
    ownerSocket.disconnect();
  });
});
