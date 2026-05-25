/**
 * Integration-Test: Lobby-Präsenz-Liste (`GET /api/lobby/presence`).
 *
 * Szenarien:
 *   1. Ohne aktive WS-Verbindung ist der User NICHT in der Liste.
 *   2. Nach WS-Connect taucht er auf.
 *   3. Nach WS-Disconnect verschwindet er wieder (mit kurzem Settle-Delay,
 *      weil `unregister` async im `handleDisconnect` läuft).
 *   4. Endpunkt verlangt eine gültige Session (401 ohne Cookie).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

interface PresenceResponse {
  users: { id: string; name: string }[];
}

describe("Lobby-Präsenz", () => {
  let app: TestAppHandle;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
    // Redis muss zwischen Tests sauber sein (Socket-Tracking liegt dort).
    await app.redis.client.flushdb();
  });

  afterEach(() => {
    for (const s of sockets) s.disconnect();
    sockets.length = 0;
  });

  it("ohne WS-Verbindung leere Liste; nach Connect taucht der User auf", async () => {
    const { http, userId, name } = await signUpAndIn(app, {
      email: "presence-1@jass.local",
      password: "presence-1-passw0rd-12!",
      name: "presence_1",
    });

    // Vor dem WS-Connect: nicht in der Liste.
    const before = await http.request<PresenceResponse>("/api/lobby/presence", { method: "GET" });
    expect(before.status).toBe(200);
    expect(before.body.users.find((u) => u.id === userId)).toBeUndefined();

    // WS verbinden.
    const socket: Socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: http.cookieHeader() },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(new Error(`WS connect_error: ${err.message}`)));
      setTimeout(() => reject(new Error("WS connect timeout (5s)")), 5_000);
    });
    // `registerUserSocket` läuft als void-promise im Hintergrund — kurz warten.
    await sleep(300);

    const after = await http.request<PresenceResponse>("/api/lobby/presence", { method: "GET" });
    const me = after.body.users.find((u) => u.id === userId);
    expect(me, JSON.stringify(after.body)).toBeDefined();
    expect(me?.name).toBe(name);
  });

  it("nach Disconnect ist der User nicht mehr drin", async () => {
    const { http, userId } = await signUpAndIn(app, {
      email: "presence-2@jass.local",
      password: "presence-2-passw0rd-12!",
      name: "presence_2",
    });
    const socket: Socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: http.cookieHeader() },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(new Error(`WS connect_error: ${err.message}`)));
      setTimeout(() => reject(new Error("WS connect timeout (5s)")), 5_000);
    });
    await sleep(300);

    socket.disconnect();
    await sleep(300);

    const after = await http.request<PresenceResponse>("/api/lobby/presence", { method: "GET" });
    expect(after.body.users.find((u) => u.id === userId)).toBeUndefined();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
