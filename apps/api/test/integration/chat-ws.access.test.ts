/**
 * Integration-Test: Chat-WS-Subscribe — Membership-Guard.
 *
 * Sichert ab, dass `chat:subscribe` die Channel-Mitgliedschaft prüft:
 * ein Nicht-Mitglied darf ein fremdes DM weder abonnieren noch die
 * Live-Nachrichten mithören. Vor diesem Guard konnte jeder eingeloggte
 * User jeden Channel-Key abonnieren und so fremde DMs/Spiel-Chats lesen.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

/** Sendet ein WS-Event und wartet auf die Ack-Antwort des Handlers. */
function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack-Timeout für ${event}`)), 4_000);
    socket.emit(event, payload, (ack: T) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

function connect(app: TestAppHandle, cookie: string): Promise<Socket> {
  const socket = io(app.baseUrl, {
    path: "/ws",
    transports: ["websocket"],
    extraHeaders: { Cookie: cookie },
    reconnection: false,
  });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => reject(new Error(`WS connect_error: ${err.message}`)));
    setTimeout(() => reject(new Error("WS connect timeout (5s)")), 5_000);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("Chat-WS — Subscribe-Membership-Guard", () => {
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

  it("Nicht-Mitglied kann ein fremdes DM nicht abonnieren und hört nichts mit", async () => {
    const alice = await signUpAndIn(app, {
      email: "alice-chat@jass.local",
      password: "alice-chat-passw0rd-12!",
      name: "alice_chat",
    });
    const bob = await signUpAndIn(app, {
      email: "bob-chat@jass.local",
      password: "bob-chat-passw0rd-12!",
      name: "bob_chat",
    });
    const eve = await signUpAndIn(app, {
      email: "eve-chat@jass.local",
      password: "eve-chat-passw0rd-12!",
      name: "eve_chat",
    });

    // DM-Channel-Key: IDs alphabetisch sortiert (Backend-Konvention).
    const dmKey = `dm:${[alice.userId, bob.userId].sort().join(":")}`;

    const eveSocket = await connect(app, eve.http.cookieHeader());
    const bobSocket = await connect(app, bob.http.cookieHeader());

    // ─── Eve (Außenstehende) versucht zu abonnieren → abgelehnt ─────────
    const eveAck = await emitAck<{ ok?: true; error?: string }>(eveSocket, "chat:subscribe", {
      channelKey: dmKey,
    });
    expect(eveAck.ok).toBeUndefined();
    expect(eveAck.error, "Eve darf das fremde DM nicht abonnieren").toBeDefined();

    // ─── Bob (Mitglied) abonniert → ok ──────────────────────────────────
    const bobAck = await emitAck<{ ok?: true; error?: string }>(bobSocket, "chat:subscribe", {
      channelKey: dmKey,
    });
    expect(bobAck.ok).toBe(true);

    const bobGot: unknown[] = [];
    const eveGot: unknown[] = [];
    bobSocket.on("chat:message", (m) => bobGot.push(m));
    eveSocket.on("chat:message", (m) => eveGot.push(m));

    // ─── Alice schickt eine DM-Nachricht ────────────────────────────────
    const sent = await alice.http.request<unknown>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ channelKey: dmKey, body: "streng geheim" }),
    });
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);

    // Auf Bobs Broadcast warten; Eve darf danach nichts erhalten haben.
    const deadline = Date.now() + 4_000;
    while (bobGot.length === 0 && Date.now() < deadline) {
      await sleep(40);
    }
    await sleep(250); // Eve genug Zeit geben, falls sie fälschlich etwas bekäme

    expect(bobGot, "Mitglied Bob muss die Nachricht erhalten").toHaveLength(1);
    expect(eveGot, "Außenstehende Eve darf nichts mitbekommen").toHaveLength(0);

    eveSocket.disconnect();
    bobSocket.disconnect();

    // ─── REST-Historie ist für Eve ebenfalls gesperrt ───────────────────
    const eveHistory = await eve.http.request<unknown>(
      `/api/chat?channelKey=${encodeURIComponent(dmKey)}&limit=50`,
      { method: "GET" }
    );
    expect(eveHistory.status).toBe(403);
  });
});
