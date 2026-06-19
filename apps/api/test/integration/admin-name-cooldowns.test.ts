/**
 * Integration-Test: Admin-Einstellung der Spielernamen-Cooldowns
 * (GET/PUT `/api/admin/name-cooldowns`) + nachweisbare Wirkung.
 *
 * Szenarien:
 *   1. GET ohne Konfiguration → Defaults (168 / 168).
 *   2. PUT aktualisiert beide Werte + schreibt Audit `admin.nameSettings.update`.
 *   3. Wirkung: Setzt der Admin den Änderungs-Cooldown auf 0, darf ein
 *      normaler User zweimal hintereinander umbenennen (im Default-Lauf wäre
 *      die zweite Änderung ein 409 — siehe username.flow.test.ts).
 *   4. Nicht-Admin → 403 auf beiden Endpunkten.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const PW = "name-cooldown-passw0rd-12!";

describe("Admin: Spielernamen-Cooldowns", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });
  beforeEach(async () => {
    await app.resetData();
  });

  it("GET liefert ohne Konfiguration die Defaults (168/168)", async () => {
    process.env["ADMIN_EMAIL"] = "cooldown-admin@jass.local";
    try {
      const { http } = await signUpAndIn(app, {
        email: "cooldown-admin@jass.local",
        password: PW,
        name: "cooldown_admin",
      });
      const r = await http.request<{ changeHours: number; releaseHours: number }>(
        "/api/admin/name-cooldowns",
        { method: "GET" }
      );
      expect(r.status).toBe(200);
      expect(r.body.changeHours).toBe(168);
      expect(r.body.releaseHours).toBe(168);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("PUT aktualisiert beide Werte und schreibt Audit", async () => {
    process.env["ADMIN_EMAIL"] = "cooldown-admin-2@jass.local";
    try {
      const { http, userId } = await signUpAndIn(app, {
        email: "cooldown-admin-2@jass.local",
        password: PW,
        name: "cooldown_admin_2",
      });
      const put = await http.request<{ changeHours: number; releaseHours: number }>(
        "/api/admin/name-cooldowns",
        { method: "PUT", body: JSON.stringify({ changeHours: 24, releaseHours: 72 }) }
      );
      expect(put.status).toBe(200);
      expect(put.body.changeHours).toBe(24);
      expect(put.body.releaseHours).toBe(72);

      const audit = await app.prisma.auditLog.findFirst({
        where: { action: "admin.nameSettings.update", actorId: userId },
      });
      expect(audit).not.toBeNull();
      const meta = audit?.meta as { changeHours?: number; releaseHours?: number };
      expect(meta.changeHours).toBe(24);
      expect(meta.releaseHours).toBe(72);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("Änderungs-Cooldown=0 erlaubt zwei Umbenennungen direkt hintereinander", async () => {
    process.env["ADMIN_EMAIL"] = "cooldown-admin-3@jass.local";
    try {
      // Admin schaltet den Änderungs-Cooldown aus.
      const { http: adminHttp } = await signUpAndIn(app, {
        email: "cooldown-admin-3@jass.local",
        password: PW,
        name: "cooldown_admin_3",
      });
      const put = await adminHttp.request("/api/admin/name-cooldowns", {
        method: "PUT",
        body: JSON.stringify({ changeHours: 0 }),
      });
      expect(put.status).toBe(200);

      // Normaler User: zweimal umbenennen — beide 200 (kein Cooldown-409).
      const u = await signUpAndIn(app, {
        email: "renamer@jass.local",
        password: PW,
        name: "Alpha",
      });
      const r1 = await u.http.request("/api/users/me/name", {
        method: "PATCH",
        body: JSON.stringify({ name: "Beta" }),
      });
      expect(r1.status).toBe(200);
      const r2 = await u.http.request("/api/users/me/name", {
        method: "PATCH",
        body: JSON.stringify({ name: "Gamma" }),
      });
      expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("Nicht-Admin bekommt 403 auf GET und PUT", async () => {
    const { http } = await signUpAndIn(app, {
      email: "no-admin-cooldown@jass.local",
      password: PW,
      name: "no_admin_cd",
    });
    const get = await http.request("/api/admin/name-cooldowns", { method: "GET" });
    expect(get.status).toBe(403);
    const put = await http.request("/api/admin/name-cooldowns", {
      method: "PUT",
      body: JSON.stringify({ changeHours: 1 }),
    });
    expect(put.status).toBe(403);
  });
});
