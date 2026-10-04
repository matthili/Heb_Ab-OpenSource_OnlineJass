/**
 * Integration-Test: Passwort ändern im Profil (`POST /api/auth/change-password`).
 *
 * Verifiziert unsere Regeln um den Better-Auth-Endpunkt:
 *   - Alle ANDEREN Sitzungen des Kontos enden, ihre Live-Verbindungen werden
 *     getrennt; die eigene Sitzung samt Tab bleibt (Better Auths eigenes
 *     `revokeOtherSessions` ist abgeschaltet, sonst flöge auch der eigene Tab).
 *   - Audit-Eintrag `auth.password.changed` und Hinweis-Mail an das Konto.
 *   - Falsches aktuelles Passwort / schwaches neues Passwort: nichts ändert sich.
 */
import { io, type Socket } from "socket.io-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { cookieHeaderFor, signUpAndIn } from "./auth-helper.js";
import { createHttpClient, type HttpClient } from "./http-client.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const PASSWORD = "change-passw0rd-alt-12!";
const NEW_PASSWORD = "change-passw0rd-neu-34!";

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
}

describe("Passwort ändern im Profil", () => {
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
    const disconnected = new Promise<string>((resolve) =>
      socket.once("disconnect", (reason) => resolve(reason))
    );
    return { socket, disconnected };
  }

  async function signInAgain(email: string, password = PASSWORD): Promise<HttpClient> {
    const http = createHttpClient(app.baseUrl);
    const res = await http.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return http;
  }

  async function signInStatus(email: string, password: string): Promise<number> {
    const res = await createHttpClient(app.baseUrl).request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return res.status;
  }

  async function sessionIdOf(http: HttpClient): Promise<string | null> {
    const res = await http.request<{ session?: { id: string } } | null>("/api/auth/get-session", {
      method: "GET",
    });
    return res.body?.session?.id ?? null;
  }

  function changePassword(
    http: HttpClient,
    body: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }
  ) {
    return http.request<{ token?: string | null; code?: string; message?: string }>(
      "/api/auth/change-password",
      { method: "POST", body: JSON.stringify(body) }
    );
  }

  async function auditActions(userId: string): Promise<string[]> {
    const rows = await app.prisma.auditLog.findMany({
      where: { target: userId, action: { startsWith: "auth.password." } },
      orderBy: { id: "asc" },
    });
    return rows.map((r) => r.action);
  }

  it("ändert das Passwort, meldet andere Sitzungen ab und trennt deren Live-Verbindungen — die eigene bleibt", async () => {
    const email = "wechsel@jass.local";
    const { http: tab, userId } = await signUpAndIn(app, {
      email,
      password: PASSWORD,
      name: "wechsel",
    });
    const otherDevice = await signInAgain(email);
    const ownSession = await sessionIdOf(tab);
    expect(ownSession).toBeTruthy();
    const liveOwn = await openLive(tab);
    const liveOther = await openLive(otherDevice);
    // Mehr als zwei: signUpAndIn hinterlässt schon zwei (Auto-Login nach der
    // Verifikation + der eigentliche Login).
    const sessionsBefore = await app.prisma.session.count({ where: { userId } });

    const res = await changePassword(tab, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // Anderes Gerät: Sitzung weg, Live-Verbindung getrennt.
    expect(await withTimeout(liveOther.disconnected, 3_000, "Trennung anderes Gerät")).toBe(
      "io server disconnect"
    );
    expect(await sessionIdOf(otherDevice)).toBeNull();
    // Eigener Tab: gleiche Sitzung, Verbindung steht weiter.
    await sleep(500);
    expect(liveOwn.socket.connected).toBe(true);
    expect(await sessionIdOf(tab)).toBe(ownSession);
    const sessions = await app.prisma.session.findMany({ where: { userId } });
    expect(sessions.map((s) => s.id)).toEqual([ownSession]);

    // Audit mit Zahl der beendeten Sitzungen.
    const audit = await app.prisma.auditLog.findFirst({
      where: { action: "auth.password.changed", target: userId },
    });
    expect(audit?.actorId).toBe(userId);
    expect(audit?.meta).toMatchObject({ sessionsRevoked: sessionsBefore - 1 });

    // Hinweis-Mail geht (nicht abgewartet) an das Konto.
    for (let i = 0; i < 20 && !app.capturedPasswordChangedMails.includes(email); i++) {
      await sleep(50);
    }
    expect(app.capturedPasswordChangedMails).toEqual([email]);

    // Altes Passwort gilt nicht mehr, das neue schon.
    expect(await signInStatus(email, PASSWORD)).toBe(401);
    expect(await signInStatus(email, NEW_PASSWORD)).toBe(200);
  });

  it("falsches aktuelles Passwort: nichts ändert sich", async () => {
    const email = "falsch@jass.local";
    const { http: tab, userId } = await signUpAndIn(app, {
      email,
      password: PASSWORD,
      name: "falsch",
    });
    const otherDevice = await signInAgain(email);
    const liveOther = await openLive(otherDevice);

    const res = await changePassword(tab, {
      currentPassword: "das-ist-nicht-das-passwort-99!",
      newPassword: NEW_PASSWORD,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe("INVALID_PASSWORD");

    await sleep(500);
    expect(liveOther.socket.connected).toBe(true);
    expect(await sessionIdOf(otherDevice)).toBeTruthy();
    expect(await auditActions(userId)).toEqual([]);
    expect(app.capturedPasswordChangedMails).toEqual([]);
    expect(await signInStatus(email, PASSWORD)).toBe(200);
  });

  it("zu schwaches neues Passwort wird abgelehnt — die Stärke-Prüfung greift auch beim Wechsel", async () => {
    const email = "schwach@jass.local";
    const { http: tab } = await signUpAndIn(app, { email, password: PASSWORD, name: "schwach" });

    // Die Test-Umgebung schaltet die Stärke-Prüfung global ab; hier gezielt an.
    const previous = process.env["DISABLE_PASSWORD_STRENGTH_CHECK"];
    delete process.env["DISABLE_PASSWORD_STRENGTH_CHECK"];
    try {
      const res = await changePassword(tab, {
        currentPassword: PASSWORD,
        newPassword: "aaaaaaaaaaaa", // 12 Zeichen = Mindestlänge, aber trivial
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.code).toBe("WEAK_PASSWORD");
    } finally {
      if (previous === undefined) delete process.env["DISABLE_PASSWORD_STRENGTH_CHECK"];
      else process.env["DISABLE_PASSWORD_STRENGTH_CHECK"] = previous;
    }
    expect(await signInStatus(email, PASSWORD)).toBe(200);
  });

  it("revokeOtherSessions im Request ändert nichts: eigene Sitzung bleibt, andere enden", async () => {
    const email = "flag@jass.local";
    const { http: tab } = await signUpAndIn(app, { email, password: PASSWORD, name: "flag" });
    const otherDevice = await signInAgain(email);
    const ownSession = await sessionIdOf(tab);
    const liveOwn = await openLive(tab);

    const res = await changePassword(tab, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Kein neues Sitzungs-Token → Better Auth hat die Sitzungen nicht selbst rotiert.
    expect(res.body.token ?? null).toBeNull();
    expect(await sessionIdOf(tab)).toBe(ownSession);
    expect(await sessionIdOf(otherDevice)).toBeNull();
    await sleep(500);
    expect(liveOwn.socket.connected).toBe(true);
  });

  it("ohne Anmeldung: 401", async () => {
    const res = await changePassword(createHttpClient(app.baseUrl), {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(401);
  });
});
