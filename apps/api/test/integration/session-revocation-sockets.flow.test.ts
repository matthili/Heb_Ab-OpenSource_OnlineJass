/**
 * Integration-Test: Endet eine Sitzung, verlieren auch ihre offenen
 * Live-Verbindungen (WebSockets) den Zugang — und zwar GENAU die betroffenen.
 *
 * Hintergrund: Die WS-Authentifizierung prüft die Sitzung nur beim
 * Verbindungsaufbau. Ohne aktives Trennen bliebe ein offener Spieltisch/Chat
 * nach Logout, Widerruf, Sperre oder Konto-Löschung bis zum nächsten
 * Verbindungsabbruch nutzbar. (Passwort-Reset: siehe password-reset.flow.test.ts.)
 *
 * Die Sockets verbinden sich wie im Web-Client mit automatischem
 * Wiederverbinden (gleiche socket.io-client-Version) — geprüft wird auch, dass
 * nach der Trennung kein Wiederverbindungsversuch folgt.
 */
import { io, type Socket } from "socket.io-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { cookieHeaderFor, signUpAndIn } from "./auth-helper.js";
import { createHttpClient, type HttpClient } from "./http-client.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const PASSWORD = "revocation-passw0rd-12!";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms} ms): ${what}`)), ms)
    ),
  ]);
}

interface LiveSocket {
  socket: Socket;
  disconnected: Promise<string>;
  reconnectAttempts: () => number;
}

describe("Sitzung endet → ihre Live-Verbindungen werden getrennt", () => {
  let app: TestAppHandle;
  const open: Socket[] = [];

  beforeAll(async () => {
    app = await setupTestApp();
  });
  beforeEach(async () => {
    await app.resetData();
  });
  afterEach(() => {
    for (const s of open.splice(0)) s.disconnect();
    delete process.env["ADMIN_EMAIL"];
  });

  async function openLive(http: HttpClient): Promise<LiveSocket> {
    const socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: cookieHeaderFor(http) },
      reconnection: true,
      reconnectionDelay: 50,
    });
    open.push(socket);
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", (err) => reject(new Error(err.message)));
      }),
      5_000,
      "WS-Verbindung"
    );
    let attempts = 0;
    socket.io.on("reconnect_attempt", () => {
      attempts++;
    });
    const disconnected = new Promise<string>((resolve) =>
      socket.once("disconnect", (reason) => resolve(reason))
    );
    return { socket, disconnected, reconnectAttempts: () => attempts };
  }

  async function expectCut(live: LiveSocket, what: string): Promise<void> {
    expect(await withTimeout(live.disconnected, 3_000, `Trennung ${what}`), what).toBe(
      "io server disconnect"
    );
    await sleep(300);
    expect(live.socket.connected, what).toBe(false);
    expect(live.reconnectAttempts(), what).toBe(0);
  }

  async function expectAlive(live: LiveSocket, what: string): Promise<void> {
    await sleep(500);
    expect(live.socket.connected, what).toBe(true);
  }

  /** Zweite (dritte, …) Sitzung desselben Users: eigener Client, eigenes Login. */
  async function signInAgain(email: string): Promise<HttpClient> {
    const http = createHttpClient(app.baseUrl);
    const res = await http.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return http;
  }

  async function currentSessionId(http: HttpClient): Promise<string> {
    const res = await http.request<{ sessions: { id: string; current: boolean }[] }>(
      "/api/users/me/sessions",
      { method: "GET" }
    );
    const id = res.body.sessions.find((s) => s.current)?.id;
    expect(id, JSON.stringify(res.body)).toBeTruthy();
    return id!;
  }

  it("Logout trennt alle Tabs DIESER Sitzung, andere Sitzungen bleiben verbunden", async () => {
    const email = "logout@jass.local";
    const a = await signUpAndIn(app, { email, password: PASSWORD, name: "logout_user" });
    const b = await signInAgain(email);
    const tab1 = await openLive(a.http);
    const tab2 = await openLive(a.http); // zweiter Tab, gleiche Sitzung
    const other = await openLive(b);

    const res = await a.http.request("/api/auth/sign-out", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    await expectCut(tab1, "Tab 1");
    await expectCut(tab2, "Tab 2");
    await expectAlive(other, "andere Sitzung");
  });

  it('„Diese Sitzung abmelden" trennt nur die widerrufene Sitzung', async () => {
    const email = "revoke-one@jass.local";
    const a = await signUpAndIn(app, { email, password: PASSWORD, name: "revoke_one" });
    const b = await signInAgain(email);
    const mine = await openLive(a.http);
    const theirs = await openLive(b);

    const sidB = await currentSessionId(b);
    const res = await a.http.request(`/api/users/me/sessions/${sidB}`, { method: "DELETE" });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    await expectCut(theirs, "widerrufene Sitzung");
    await expectAlive(mine, "eigene Sitzung");
  });

  it('„Alle anderen abmelden" trennt alle anderen Sitzungen, die eigene bleibt', async () => {
    const email = "revoke-all@jass.local";
    const a = await signUpAndIn(app, { email, password: PASSWORD, name: "revoke_all" });
    const b = await signInAgain(email);
    const c = await signInAgain(email);
    const mine = await openLive(a.http);
    const otherB = await openLive(b);
    const otherC = await openLive(c);

    const res = await a.http.request("/api/users/me/sessions", { method: "DELETE" });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    await expectCut(otherB, "Sitzung B");
    await expectCut(otherC, "Sitzung C");
    await expectAlive(mine, "eigene Sitzung");
  });

  it("Sperre durch den Admin trennt alle Verbindungen des Gesperrten", async () => {
    const email = "troll@jass.local";
    const troll = await signUpAndIn(app, { email, password: PASSWORD, name: "troll" });
    const trollB = await signInAgain(email);
    process.env["ADMIN_EMAIL"] = "sperr-admin@jass.local";
    const admin = await signUpAndIn(app, {
      email: "sperr-admin@jass.local",
      password: PASSWORD,
      name: "sperr_admin",
    });
    const trollLive = await openLive(troll.http);
    const trollLiveB = await openLive(trollB);
    const adminLive = await openLive(admin.http);

    const res = await admin.http.request(`/api/admin/users/${troll.userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "BLOCKED" }),
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    await expectCut(trollLive, "Gesperrter, Sitzung 1");
    await expectCut(trollLiveB, "Gesperrter, Sitzung 2");
    await expectAlive(adminLive, "Admin");
    expect(await app.prisma.session.count({ where: { userId: troll.userId } })).toBe(0);
  });

  it("DSGVO-Löschung trennt alle Verbindungen des gelöschten Kontos", async () => {
    const email = "loeschen@jass.local";
    const a = await signUpAndIn(app, { email, password: PASSWORD, name: "loeschen" });
    const b = await signInAgain(email);
    const liveA = await openLive(a.http);
    const liveB = await openLive(b);

    const res = await a.http.request("/api/users/me", { method: "DELETE" });
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    await expectCut(liveA, "Sitzung 1");
    await expectCut(liveB, "Sitzung 2");
  });
});
