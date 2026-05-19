/**
 * Integration-Test: Auth-Flow von Registrierung bis eingeloggter Session.
 *
 * **Was hier passieren muss** (Plan-Doc §11, Schritt 1+4):
 *   1. POST /api/auth/sign-up/email → 200, User in DB, emailVerified=false,
 *      Verify-Mail im Sink.
 *   2. GET /api/auth/verify-email?token=… → 302, emailVerified=true.
 *   3. POST /api/auth/sign-in/email → 200, Session-Cookie gesetzt.
 *   4. GET /api/auth/get-session mit Cookie → 200, User-Felder zurück.
 *
 * Wir prüfen NICHT das ganze Better-Auth-Response-Schema, sondern nur die
 * sicherheits-relevanten Punkte (emailVerified, Cookie da, User in DB).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createHttpClient, type HttpClient } from "./http-client.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("M3 auth flow (register → verify → login → session)", () => {
  let app: TestAppHandle;
  let http: HttpClient;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
    http = createHttpClient(app.baseUrl);
  });

  afterAll(async () => {
    // App-Close passiert im globalTeardown; hier kein cleanup nötig.
  });

  it("registriert User, verschickt Verify-Mail, akzeptiert sie und loggt ein", async () => {
    const email = "test@jass.local";
    const password = "test-passw0rd-very-long-12!";
    const name = "test_user";

    // ─── 1. sign-up ────────────────────────────────────────────────────
    const signUp = await http.request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
    expect(signUp.status, JSON.stringify(signUp.body)).toBe(200);

    // User existiert in DB, aber noch nicht verifiziert
    const dbUser = await app.prisma.user.findUnique({ where: { email } });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.emailVerified).toBe(false);
    expect(dbUser?.name).toBe(name);

    // Verify-Mail im Sink
    expect(app.capturedMails).toHaveLength(1);
    expect(app.capturedMails[0]?.to).toBe(email);
    const verifyUrl = app.capturedMails[0]?.verifyUrl;
    expect(verifyUrl).toMatch(/\/verify-email\?token=/);

    // Audit: register.success eingetragen
    const auditAfterRegister = await app.prisma.auditLog.findMany({
      where: { action: "auth.register.success" },
    });
    expect(auditAfterRegister).toHaveLength(1);

    // ─── 2. Login VOR Verify scheitert (requireEmailVerification: true) ─
    const loginUnverified = await http.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    // Better Auth liefert 403 (oder 401) für "email not verified". Wir prüfen
    // nur, dass der Login-Versuch fehlschlägt — der genaue Code ist
    // implementation detail.
    expect(loginUnverified.status, JSON.stringify(loginUnverified.body)).toBeGreaterThanOrEqual(
      400
    );

    // ─── 3. Verify-Link klicken ────────────────────────────────────────
    // Die URL hat das volle Schema vom BETTER_AUTH_URL — Pfad + Query
    // extrahieren und an unseren baseUrl anhängen.
    const url = new URL(verifyUrl!);
    const verify = await http.request(`${url.pathname}${url.search}`, {
      method: "GET",
      redirect: "manual",
    });
    // Better Auth redirected nach erfolgreichem Verify auf callbackURL — der
    // 30x reicht uns als „verify hat geklappt".
    expect(verify.status).toBeGreaterThanOrEqual(200);
    expect(verify.status).toBeLessThan(400);

    const dbUserAfter = await app.prisma.user.findUnique({ where: { email } });
    expect(dbUserAfter?.emailVerified).toBe(true);

    // ─── 4. Sign-in mit verifizierter Mail ─────────────────────────────
    const signIn = await http.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);

    // Session-Cookie gesetzt
    expect(http.cookies.size).toBeGreaterThan(0);
    const cookieNames = Array.from(http.cookies.keys());
    expect(cookieNames.some((n) => n.startsWith("jass."))).toBe(true);

    // Audit: login.success
    const auditLogins = await app.prisma.auditLog.findMany({
      where: { action: "auth.login.success" },
    });
    expect(auditLogins.length).toBeGreaterThanOrEqual(1);

    // ─── 5. Session-Lookup mit Cookie ──────────────────────────────────
    interface SessionResponse {
      user?: { email: string; emailVerified: boolean };
    }
    const session = await http.request<SessionResponse>("/api/auth/get-session", {
      method: "GET",
    });
    expect(session.status).toBe(200);
    expect(session.body?.user?.email).toBe(email);
    expect(session.body?.user?.emailVerified).toBe(true);
  });

  it("blockt Registrierung mit blockierter E-Mail-Domain", async () => {
    // Domain auf die Blocklist setzen
    await app.prisma.blocklist.create({
      data: { pattern: "@bad-domain.test", reason: "Test-Block" },
    });

    const signUp = await http.request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email: "spam@bad-domain.test",
        password: "test-passw0rd-very-long-12!",
        name: "spammer",
      }),
    });
    expect(signUp.status).toBeGreaterThanOrEqual(400);

    // Kein User angelegt, dafür Audit-Log mit auth.register.blocked
    const blockedAudits = await app.prisma.auditLog.findMany({
      where: { action: "auth.register.blocked" },
    });
    expect(blockedAudits).toHaveLength(1);
    const users = await app.prisma.user.findMany();
    expect(users).toHaveLength(0);

    // Mail-Sink leer
    expect(app.capturedMails).toHaveLength(0);
  });

  it("lehnt Registrierung mit schwachem Passwort ab (zxcvbn)", async () => {
    // Wir aktivieren den zxcvbn-Check für diesen einen Test, indem wir
    // das Test-Override-Flag vorübergehend rausnehmen.
    const before = process.env["DISABLE_PASSWORD_STRENGTH_CHECK"];
    delete process.env["DISABLE_PASSWORD_STRENGTH_CHECK"];
    try {
      const weak = await http.request("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({
          email: "weak@jass.local",
          password: "password1234", // klassisches schwaches Passwort
          name: "weakling",
        }),
      });
      expect(weak.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(weak.body)).toMatch(/WEAK_PASSWORD|zu schwach/i);

      // Kein User angelegt
      const users = await app.prisma.user.findMany({ where: { email: "weak@jass.local" } });
      expect(users).toHaveLength(0);
    } finally {
      if (before !== undefined) process.env["DISABLE_PASSWORD_STRENGTH_CHECK"] = before;
    }
  });
});
