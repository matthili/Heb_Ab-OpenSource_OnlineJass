/**
 * Integration-Test: „Passwort vergessen" von der Anfrage bis zum Login mit dem
 * neuen Passwort.
 *
 * Hintergrund: Better Auth hat `/forget-password` in `/request-password-reset`
 * umbenannt. Das Reset-Formular rief den alten Pfad auf (Antwort wurde
 * ignoriert), Captcha-Pflicht und Rate-Limit hingen ebenfalls am alten Pfad —
 * und kein Test deckte den Ablauf ab (der Mail-Sink verwarf Reset-Mails sogar).
 *
 *   1. POST /api/auth/request-password-reset → 200, Reset-Mail im Sink.
 *   2. GET  <Link aus der Mail>              → 302 auf redirectTo?token=…
 *   3. POST /api/auth/reset-password          → 200.
 *   4. Login mit dem neuen Passwort klappt, mit dem alten nicht mehr.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TurnstileService } from "../../src/modules/auth/turnstile.service.js";
import { signUpAndIn } from "./auth-helper.js";
import { createHttpClient, type HttpClient } from "./http-client.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const RESET_REQUEST = "/api/auth/request-password-reset";
const PASSWORD = "test-passw0rd-very-long-12!";

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

  it("schickt eine Reset-Mail, deren Link ein neues Passwort setzen lässt", async () => {
    const email = "reset@jass.local";
    const newPassword = "neues-passw0rt-sehr-lang-34!";
    await signUpAndIn(app, { email, password: PASSWORD, name: "reset_user" });

    // ─── 1. Reset anfordern ───────────────────────────────────────────────
    const request = await http.request(RESET_REQUEST, {
      method: "POST",
      body: JSON.stringify({ email, redirectTo: "/reset-password" }),
    });
    expect(request.status, JSON.stringify(request.body)).toBe(200);
    expect(app.capturedResetMails).toHaveLength(1);
    expect(app.capturedResetMails[0]?.to).toBe(email);

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
    } finally {
      if (before !== undefined) process.env["DISABLE_TURNSTILE"] = before;
    }
  });
});
