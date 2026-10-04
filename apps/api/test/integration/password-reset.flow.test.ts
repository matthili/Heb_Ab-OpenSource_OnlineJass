/**
 * Integration-Test: „Passwort vergessen" von der Anfrage bis zum Login mit dem
 * neuen Passwort.
 *
 * Hintergrund: Better Auth hat `/forget-password` in `/request-password-reset`
 * umbenannt. Das Reset-Formular rief den alten Pfad auf (Antwort wurde
 * ignoriert), Captcha-Pflicht und Rate-Limit hingen ebenfalls am alten Pfad —
 * und kein Test deckte den Ablauf ab (der Mail-Sink verwarf Reset-Mails sogar).
 *
 *   1. POST /api/auth/request-password-reset → 200, Reset-Mail im Sink,
 *      Audit `auth.password.reset_requested`.
 *   2. GET  <Link aus der Mail>              → 302 auf redirectTo?token=…
 *   3. POST /api/auth/reset-password          → 200, Audit
 *      `auth.password.reset_completed`; alle Sitzungen des Kontos beendet,
 *      offene WebSockets getrennt.
 *   4. Login mit dem neuen Passwort klappt, mit dem alten nicht mehr.
 */
import { io } from "socket.io-client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TurnstileService } from "../../src/modules/auth/turnstile.service.js";
import { cookieHeaderFor, signUpAndIn } from "./auth-helper.js";
import { createHttpClient, type HttpClient } from "./http-client.js";
import { MAIL_FAIL_PREFIX, setupTestApp, type TestAppHandle } from "./setup.js";

const RESET_REQUEST = "/api/auth/request-password-reset";
const PASSWORD = "test-passw0rd-very-long-12!";

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

describe("Passwort vergessen (request-password-reset → Link → neues Passwort)", () => {
  let app: TestAppHandle;
  let http: HttpClient;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
    // Ausgeloggter Client — wie jemand, der sein Passwort vergessen hat.
    http = createHttpClient(app.baseUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Reset anfordern, Link aus der Mail öffnen, Token aus der Weiterleitung holen. */
  async function requestResetToken(email: string): Promise<string> {
    const request = await http.request(RESET_REQUEST, {
      method: "POST",
      body: JSON.stringify({ email, redirectTo: "/reset-password" }),
    });
    expect(request.status, JSON.stringify(request.body)).toBe(200);
    const mail = app.capturedResetMails.filter((m) => m.to === email).pop();
    expect(mail, "keine Reset-Mail im Sink").toBeDefined();
    const link = new URL(mail!.resetUrl);
    const callback = await fetch(`${app.baseUrl}${link.pathname}${link.search}`, {
      redirect: "manual",
    });
    const location = callback.headers.get("location") ?? "";
    const token = new URL(location, app.baseUrl).searchParams.get("token");
    expect(token, location).toBeTruthy();
    return token!;
  }

  it("schickt eine Reset-Mail, deren Link ein neues Passwort setzen lässt", async () => {
    const email = "reset@jass.local";
    const newPassword = "neues-passw0rt-sehr-lang-34!";
    const { userId } = await signUpAndIn(app, { email, password: PASSWORD, name: "reset_user" });

    // ─── 1. Reset anfordern ───────────────────────────────────────────────
    const request = await http.request(RESET_REQUEST, {
      method: "POST",
      body: JSON.stringify({ email, redirectTo: "/reset-password" }),
    });
    expect(request.status, JSON.stringify(request.body)).toBe(200);
    expect(app.capturedResetMails).toHaveLength(1);
    expect(app.capturedResetMails[0]?.to).toBe(email);

    // Audit: angefordert — anonym (kein actorId), das Konto als target.
    const requested = await app.prisma.auditLog.findMany({
      where: { action: "auth.password.reset_requested" },
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]?.actorId).toBeNull();
    expect(requested[0]?.target).toBe(userId);
    expect(requested[0]?.meta).toMatchObject({ email, mailSent: true });

    // ─── 2. Link aus der Mail → Weiterleitung mit Token ───────────────────
    // Die URL trägt das Schema von BETTER_AUTH_URL — Pfad + Query an unsere
    // baseUrl hängen (wie im Verify-Test).
    const link = new URL(app.capturedResetMails[0]!.resetUrl);
    const callback = await fetch(`${app.baseUrl}${link.pathname}${link.search}`, {
      redirect: "manual",
    });
    expect(callback.status).toBe(302);
    const location = callback.headers.get("location") ?? "";
    const token = new URL(location, app.baseUrl).searchParams.get("token");
    expect(token, location).toBeTruthy();

    // ─── 3. Neues Passwort setzen ─────────────────────────────────────────
    const reset = await http.request("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ newPassword, token }),
    });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);

    // Audit: abgeschlossen — durch den Konto-Inhaber (hatte den Mail-Link).
    const completed = await app.prisma.auditLog.findMany({
      where: { action: "auth.password.reset_completed" },
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]?.actorId).toBe(userId);
    expect(completed[0]?.target).toBe(userId);

    // ─── 4. Altes Passwort gilt nicht mehr, neues schon ───────────────────
    const oldLogin = await createHttpClient(app.baseUrl).request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(oldLogin.status).toBeGreaterThanOrEqual(400);
    const newLogin = await createHttpClient(app.baseUrl).request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password: newPassword }),
    });
    expect(newLogin.status, JSON.stringify(newLogin.body)).toBe(200);
  });

  it("beendet nach dem Reset alle Sitzungen und trennt offene Live-Verbindungen", async () => {
    const email = "revoke@jass.local";
    const owner = await signUpAndIn(app, { email, password: PASSWORD, name: "revoke_user" });

    // Offene Live-Verbindung mit der gleich widerrufenen Sitzung. Automatisches
    // Wiederverbinden AN, wie im Web-Client (gleiche socket.io-client-Version).
    const socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: cookieHeaderFor(owner.http) },
      reconnection: true,
      reconnectionDelay: 50,
    });
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          socket.once("connect", () => resolve());
          socket.once("connect_error", (err) => reject(new Error(err.message)));
        }),
        5_000,
        "WS-Verbindung"
      );
      let reconnectAttempts = 0;
      socket.io.on("reconnect_attempt", () => {
        reconnectAttempts++;
      });
      const disconnected = new Promise<string>((resolve) =>
        socket.once("disconnect", (reason) => resolve(reason))
      );

      const token = await requestResetToken(email);
      const reset = await http.request("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ newPassword: "neues-passw0rt-sehr-lang-56!", token }),
      });
      expect(reset.status, JSON.stringify(reset.body)).toBe(200);

      // Der Server trennt die Live-Verbindung …
      expect(await withTimeout(disconnected, 3_000, "WS-Trennung")).toBe("io server disconnect");
      // … und der Client versucht nicht, sich neu zu verbinden.
      await sleep(500);
      expect(socket.connected).toBe(false);
      expect(reconnectAttempts).toBe(0);

      // Alle Sitzungen des Kontos sind weg, das alte Cookie gilt nicht mehr.
      expect(await app.prisma.session.count({ where: { userId: owner.userId } })).toBe(0);
      const session = await owner.http.request<{ user?: unknown } | null>("/api/auth/get-session", {
        method: "GET",
      });
      expect(session.body?.user ?? null).toBeNull();

      const completed = await app.prisma.auditLog.findFirst({
        where: { action: "auth.password.reset_completed" },
      });
      const meta = completed?.meta as { sessionsRevoked?: number } | undefined;
      expect(meta?.sessionsRevoked).toBeGreaterThanOrEqual(1);
    } finally {
      socket.disconnect();
    }
  });

  it("antwortet bei unbekannter Adresse gleich und verschickt nichts", async () => {
    const known = "known@jass.local";
    await signUpAndIn(app, { email: known, password: PASSWORD, name: "known_user" });

    const forKnown = await http.request(RESET_REQUEST, {
      method: "POST",
      body: JSON.stringify({ email: known, redirectTo: "/reset-password" }),
    });
    const forUnknown = await http.request(RESET_REQUEST, {
      method: "POST",
      body: JSON.stringify({ email: "nobody@jass.local", redirectTo: "/reset-password" }),
    });

    // Gleiche Antwort = kein Rückschluss, ob die Adresse registriert ist.
    expect(forUnknown.status).toBe(forKnown.status);
    expect(forUnknown.body).toEqual(forKnown.body);
    expect(app.capturedResetMails.map((m) => m.to)).toEqual([known]);

    // Audit nur für das existierende Konto — keine fremde Adresse im Log.
    const requested = await app.prisma.auditLog.findMany({
      where: { action: "auth.password.reset_requested" },
    });
    expect(requested.map((r) => (r.meta as { email?: string }).email)).toEqual([known]);
  });

  it("scheitert die Reset-Mail am Mailserver: gleiche Antwort, Audit mit mailSent:false", async () => {
    const email = `${MAIL_FAIL_PREFIX}jass.local`;
    const { userId } = await signUpAndIn(app, { email, password: PASSWORD, name: "smtp_fail" });

    const response = await http.request(RESET_REQUEST, {
      method: "POST",
      body: JSON.stringify({ email, redirectTo: "/reset-password" }),
    });
    // Nach außen dieselbe Antwort wie immer — ein SMTP-Ausfall verrät nicht,
    // dass die Adresse existiert.
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(app.capturedResetMails).toHaveLength(0);

    const requested = await app.prisma.auditLog.findMany({
      where: { action: "auth.password.reset_requested" },
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]?.target).toBe(userId);
    expect(requested[0]?.meta).toMatchObject({ email, mailSent: false });
  });

  it("verlangt auf dem Reset-Endpunkt das Captcha", async () => {
    const email = "captcha@jass.local";
    // User VOR dem Einschalten des Captchas anlegen (Sign-up bräuchte es sonst auch).
    await signUpAndIn(app, { email, password: PASSWORD, name: "captcha_user" });

    // Test-Setup schaltet Turnstile global ab — für diesen Test wieder an und
    // die Cloudflare-Prüfung durch eine Ablehnung ersetzen (kein Netz nötig).
    const before = process.env["DISABLE_TURNSTILE"];
    delete process.env["DISABLE_TURNSTILE"];
    const verify = vi
      .spyOn(TurnstileService.prototype, "verify")
      .mockResolvedValue({ ok: false, errors: ["test-reject"] });
    try {
      const response = await http.request(RESET_REQUEST, {
        method: "POST",
        body: JSON.stringify({ email, redirectTo: "/reset-password" }),
      });
      expect(response.status, JSON.stringify(response.body)).toBe(400);
      expect(JSON.stringify(response.body)).toMatch(/CAPTCHA_FAILED/);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(app.capturedResetMails).toHaveLength(0);

      const rejects = await app.prisma.auditLog.findMany({
        where: { action: "security.captcha.reject" },
      });
      expect(rejects).toHaveLength(1);
      expect(rejects[0]?.meta).toMatchObject({
        path: "/request-password-reset",
        errors: ["test-reject"],
      });
      // Abgewiesen = kein Reset angefordert.
      const requested = await app.prisma.auditLog.findMany({
        where: { action: "auth.password.reset_requested" },
      });
      expect(requested).toHaveLength(0);
    } finally {
      if (before !== undefined) process.env["DISABLE_TURNSTILE"] = before;
    }
  });
});
