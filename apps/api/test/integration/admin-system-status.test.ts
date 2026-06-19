/**
 * Integration-Test: Admin-System-Status (GET `/api/admin/system-status`).
 *
 * Fokus auf die neu ergänzten Felder `smtp` + `landing`:
 *   - der Endpunkt antwortet zügig (SMTP-Verify läuft in ein Timeout/Catch,
 *     hängt die Antwort also nicht auf, auch ohne erreichbaren Mailserver);
 *   - `smtp` liefert host/port/ok, `landing` liefert url/ok;
 *   - ohne gesetztes `LANDING_URL` ist `landing.ok === null` (= nicht konfiguriert).
 *   - Nicht-Admin → 403.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const PW = "system-status-passw0rd-12!";

interface StatusBody {
  smtp: { host: string; port: number; ok: boolean };
  landing: { url: string | null; ok: boolean | null };
}

describe("Admin: System-Status (SMTP + Landing)", () => {
  let app: TestAppHandle;
  const hadLandingUrl = "LANDING_URL" in process.env;
  const prevLandingUrl = process.env["LANDING_URL"];

  beforeAll(async () => {
    // Sicherstellen, dass im Test kein LANDING_URL gesetzt ist → ok=null.
    delete process.env["LANDING_URL"];
    app = await setupTestApp();
  });
  beforeEach(async () => {
    await app.resetData();
  });
  afterAll(() => {
    if (hadLandingUrl) process.env["LANDING_URL"] = prevLandingUrl;
  });

  it("liefert smtp + landing und antwortet ohne Hänger", async () => {
    process.env["ADMIN_EMAIL"] = "status-admin@jass.local";
    try {
      const { http } = await signUpAndIn(app, {
        email: "status-admin@jass.local",
        password: PW,
        name: "status_admin",
      });

      const started = Date.now();
      const r = await http.request<StatusBody>("/api/admin/system-status", { method: "GET" });
      const elapsed = Date.now() - started;

      expect(r.status).toBe(200);
      // SMTP: host/port/ok vorhanden; ok ist ein Boolean (false ohne Mailserver).
      expect(typeof r.body.smtp.host).toBe("string");
      expect(typeof r.body.smtp.port).toBe("number");
      expect(typeof r.body.smtp.ok).toBe("boolean");
      // Landing ohne LANDING_URL → nicht konfiguriert.
      expect(r.body.landing.url).toBeNull();
      expect(r.body.landing.ok).toBeNull();
      // Der Verify-Timeout liegt bei 4 s — die Antwort muss klar darunter bleiben.
      expect(elapsed).toBeLessThan(8000);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("Nicht-Admin bekommt 403", async () => {
    const { http } = await signUpAndIn(app, {
      email: "no-admin-status@jass.local",
      password: PW,
      name: "no_admin_status",
    });
    const r = await http.request("/api/admin/system-status", { method: "GET" });
    expect(r.status).toBe(403);
  });
});
