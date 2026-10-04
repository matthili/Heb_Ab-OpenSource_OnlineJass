/**
 * Integration-Test: SMTP-Testmail aus dem Admin-Panel (`POST /api/admin/smtp/test`).
 *
 * Bisher ließ sich eine SMTP-Konfiguration nur prüfen, indem man einen User
 * anlegte oder ein Passwort zurücksetzte. Der Endpunkt schickt eine Testmail mit
 * den gespeicherten Einstellungen an eine frei wählbare Adresse:
 *   - Erfolg → `{ ok: true }`, Mail beim Sink, Audit `admin.smtp.test`.
 *   - Mailserver lehnt ab → trotzdem 2xx, `{ ok: false, error }` mit dessen
 *     Meldung (damit das Panel sie zeigen kann), Audit mit `ok: false`.
 *   - Nur für Admins, nur gültige Adressen, pro Admin gedeckelt (429).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { MAIL_FAIL_PREFIX, setupTestApp, type TestAppHandle } from "./setup.js";

const PW = "smtp-test-passw0rd-12!";
const ENDPOINT = "/api/admin/smtp/test";

type TestResult = { ok: true } | { ok: false; error: string };

describe("Admin: SMTP-Testmail", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });
  beforeEach(async () => {
    await app.resetData();
  });
  afterEach(() => {
    delete process.env["ADMIN_EMAIL"];
  });

  async function signInAdmin(email: string) {
    process.env["ADMIN_EMAIL"] = email;
    return signUpAndIn(app, {
      email,
      password: PW,
      name: email.split("@")[0]!.replace(/\W/g, "_"),
    });
  }

  it("verschickt die Testmail und protokolliert den Versuch", async () => {
    const { http, userId } = await signInAdmin("smtp-tester@jass.local");

    const res = await http.request<TestResult>(ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ to: "empfaenger@jass.test" }),
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(res.body).toEqual({ ok: true });
    expect(app.capturedSmtpTestMails).toEqual(["empfaenger@jass.test"]);

    const audits = await app.prisma.auditLog.findMany({ where: { action: "admin.smtp.test" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(userId);
    expect(audits[0]?.meta).toMatchObject({ to: "empfaenger@jass.test", ok: true });
  });

  it("meldet einen Fehler des Mailservers als ok:false mit dessen Meldung", async () => {
    const { http } = await signInAdmin("smtp-tester2@jass.local");
    const to = `${MAIL_FAIL_PREFIX}jass.test`;

    const res = await http.request<TestResult>(ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ to }),
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(res.body.ok).toBe(false);
    if (!res.body.ok) {
      expect(res.body.error).toMatch(/^EAUTH: Invalid login: 535/);
    }
    expect(app.capturedSmtpTestMails).toHaveLength(0);

    const audits = await app.prisma.auditLog.findMany({ where: { action: "admin.smtp.test" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.meta).toMatchObject({ to, ok: false });
  });

  it("verweigert Nicht-Admins und ungültige Adressen", async () => {
    const player = await signUpAndIn(app, {
      email: "spieler@jass.local",
      password: PW,
      name: "spieler",
    });
    const asPlayer = await player.http.request(ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ to: "empfaenger@jass.test" }),
    });
    expect(asPlayer.status).toBe(403);

    const { http } = await signInAdmin("smtp-tester3@jass.local");
    const invalid = await http.request(ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ to: "keine-adresse" }),
    });
    expect(invalid.status).toBe(400);
    expect(app.capturedSmtpTestMails).toHaveLength(0);
  });

  it("deckelt Testmails pro Admin (10 je 10 Minuten)", async () => {
    const { http } = await signInAdmin("smtp-tester4@jass.local");
    for (let i = 0; i < 10; i++) {
      const res = await http.request(ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ to: `empfaenger${i}@jass.test` }),
      });
      expect(res.status, `Versuch ${i + 1}`).toBeLessThan(300);
    }
    const blocked = await http.request(ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ to: "einer-zu-viel@jass.test" }),
    });
    expect(blocked.status).toBe(429);
    expect(app.capturedSmtpTestMails).toHaveLength(10);
  });
});
