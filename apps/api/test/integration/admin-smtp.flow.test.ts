/**
 * Integration-Test: Das SMTP-Panel (`GET /api/admin/smtp`) zeigt die EFFEKTIVE
 * Konfiguration — Env-Defaults + DB-Overrides gemerged. Früher las es nur die
 * DB → per `.env` gesetzte Werte erschienen als leere Felder. Folge: wer nur den
 * Absender ändern wollte, sah Host/Port leer und fürchtete, sie zu verlieren.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const PW = "smtp-view-passw0rd-12!";

interface SmtpView {
  host: string;
  port: number;
  from: string;
  hasPassword: boolean;
}

describe("Admin: SMTP-Panel zeigt effektive Konfig", () => {
  let app: TestAppHandle;
  const prev = {
    host: process.env["SMTP_HOST"],
    port: process.env["SMTP_PORT"],
    from: process.env["SMTP_FROM"],
  };

  beforeAll(async () => {
    app = await setupTestApp();
  });
  beforeEach(async () => {
    await app.resetData();
  });
  afterEach(() => {
    for (const [k, v] of [
      ["SMTP_HOST", prev.host],
      ["SMTP_PORT", prev.port],
      ["SMTP_FROM", prev.from],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env["ADMIN_EMAIL"];
  });

  it("zeigt per .env gesetzte Werte (nicht leer) und behält sie bei partiellem Update", async () => {
    process.env["SMTP_HOST"] = "mail.from-env.test";
    process.env["SMTP_PORT"] = "2525";
    process.env["SMTP_FROM"] = "env-absender@jass.test";
    process.env["ADMIN_EMAIL"] = "smtp-admin@jass.local";

    const { http } = await signUpAndIn(app, {
      email: "smtp-admin@jass.local",
      password: PW,
      name: "smtp_admin",
    });

    // GET: die Env-Werte sind sichtbar (vorher: leer).
    const before = await http.request<SmtpView>("/api/admin/smtp", { method: "GET" });
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.host).toBe("mail.from-env.test");
    expect(before.body.port).toBe(2525);
    expect(before.body.from).toBe("env-absender@jass.test");

    // Nur den Absender ändern …
    const put = await http.request("/api/admin/smtp", {
      method: "PUT",
      body: JSON.stringify({ from: "neu@jass.test" }),
    });
    expect(put.status, JSON.stringify(put.body)).toBeLessThan(300);

    // … From ist geändert, Host/Port (aus der Env) NICHT verloren.
    const after = await http.request<SmtpView>("/api/admin/smtp", { method: "GET" });
    expect(after.body.from).toBe("neu@jass.test");
    expect(after.body.host).toBe("mail.from-env.test");
    expect(after.body.port).toBe(2525);
  });
});
