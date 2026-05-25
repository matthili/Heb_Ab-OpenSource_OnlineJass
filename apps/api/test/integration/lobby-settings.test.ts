/**
 * Integration-Test: globale Lobby-Einstellungen (Admin-CRUD + Wirkung in
 * `openTable`).
 *
 * Szenarien:
 *   1. GET ohne vorherigen PUT → Defaults (100 / 6 / 1000).
 *   2. PUT aktualisiert Teilmengen idempotent; Audit-Eintrag wird geschrieben.
 *   3. Ein neuer Tisch ohne explizites `targetScore` übernimmt den
 *      `defaultPointsTarget` aus den Settings.
 *   4. Wenn `maxOpenTables = 1` und schon ein Tisch existiert, lehnt
 *      `openTable` einen zweiten ab (Conflict).
 *   5. Nicht-Admin → 403 auf beiden Endpunkten.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("Globale Lobby-Einstellungen", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  it("GET liefert ohne Konfiguration die Defaults", async () => {
    process.env["ADMIN_EMAIL"] = "settings-admin@jass.local";
    try {
      const { http } = await signUpAndIn(app, {
        email: "settings-admin@jass.local",
        password: "settings-admin-passw0rd-12!",
        name: "settings_admin",
      });
      const r = await http.request<{
        maxOpenTables: number;
        maxSeatsPerTable: number;
        defaultPointsTarget: number;
      }>("/api/admin/lobby-settings", { method: "GET" });
      expect(r.status).toBe(200);
      expect(r.body.maxOpenTables).toBe(100);
      expect(r.body.maxSeatsPerTable).toBe(6);
      expect(r.body.defaultPointsTarget).toBe(1000);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("PUT aktualisiert teilweise und schreibt Audit", async () => {
    process.env["ADMIN_EMAIL"] = "settings-admin-2@jass.local";
    try {
      const { http, userId } = await signUpAndIn(app, {
        email: "settings-admin-2@jass.local",
        password: "settings-admin2-passw0rd-12!",
        name: "settings_admin_2",
      });
      const put = await http.request<{
        maxOpenTables: number;
        defaultPointsTarget: number;
      }>("/api/admin/lobby-settings", {
        method: "PUT",
        body: JSON.stringify({ maxOpenTables: 42, defaultPointsTarget: 2500 }),
      });
      expect(put.status).toBe(200);
      expect(put.body.maxOpenTables).toBe(42);
      expect(put.body.defaultPointsTarget).toBe(2500);

      const audit = await app.prisma.auditLog.findFirst({
        where: { action: "admin.lobbySettings.update", actorId: userId },
      });
      expect(audit).not.toBeNull();
      const meta = audit?.meta as { maxOpenTables?: number; defaultPointsTarget?: number };
      expect(meta.maxOpenTables).toBe(42);
      expect(meta.defaultPointsTarget).toBe(2500);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("openTable ohne explizites targetScore übernimmt den Admin-Default", async () => {
    process.env["ADMIN_EMAIL"] = "settings-admin-3@jass.local";
    try {
      // Admin setzt Default 2500.
      const { http: adminHttp } = await signUpAndIn(app, {
        email: "settings-admin-3@jass.local",
        password: "settings-admin3-passw0rd-12!",
        name: "settings_admin_3",
      });
      await adminHttp.request("/api/admin/lobby-settings", {
        method: "PUT",
        body: JSON.stringify({ defaultPointsTarget: 2500 }),
      });

      // Normaler User eröffnet einen Tisch OHNE targetScore.
      const { http } = await signUpAndIn(app, {
        email: "table-opener@jass.local",
        password: "table-opener-passw0rd-12!",
        name: "table_opener",
      });
      const create = await http.request<{ tableId: string }>("/api/lobby/tables", {
        method: "POST",
        body: JSON.stringify({
          joinMode: "OPEN",
          variant: "BODENSEE_2P",
          aiSeatType: "random",
          initialAiSeats: [{ seat: 1 }],
        }),
      });
      expect(create.status, JSON.stringify(create.body)).toBe(201);

      const detail = await app.prisma.lobbyTable.findUnique({
        where: { id: create.body.tableId },
        select: { targetScore: true },
      });
      expect(detail?.targetScore).toBe(2500);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("maxOpenTables=1 lehnt einen zweiten Tisch ab", async () => {
    process.env["ADMIN_EMAIL"] = "settings-admin-4@jass.local";
    try {
      const { http: adminHttp } = await signUpAndIn(app, {
        email: "settings-admin-4@jass.local",
        password: "settings-admin4-passw0rd-12!",
        name: "settings_admin_4",
      });
      await adminHttp.request("/api/admin/lobby-settings", {
        method: "PUT",
        body: JSON.stringify({ maxOpenTables: 1 }),
      });

      // User A eröffnet — passt.
      const { http: httpA } = await signUpAndIn(app, {
        email: "first-table@jass.local",
        password: "first-table-passw0rd-12!",
        name: "first_table",
      });
      const ok = await httpA.request("/api/lobby/tables", {
        method: "POST",
        body: JSON.stringify({
          joinMode: "OPEN",
          variant: "BODENSEE_2P",
          aiSeatType: "random",
          initialAiSeats: [{ seat: 1 }],
        }),
      });
      expect(ok.status).toBe(201);

      // User B versucht zweiten Tisch — geblockt.
      const { http: httpB } = await signUpAndIn(app, {
        email: "second-table@jass.local",
        password: "second-table-passw0rd-12!",
        name: "second_table",
      });
      const reject = await httpB.request("/api/lobby/tables", {
        method: "POST",
        body: JSON.stringify({
          joinMode: "OPEN",
          variant: "BODENSEE_2P",
          aiSeatType: "random",
          initialAiSeats: [{ seat: 1 }],
        }),
      });
      expect(reject.status).toBe(409);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("Nicht-Admin bekommt 403 auf GET und PUT", async () => {
    const { http } = await signUpAndIn(app, {
      email: "no-admin-settings@jass.local",
      password: "no-admin-passw0rd-12!",
      name: "no_admin_set",
    });
    const get = await http.request("/api/admin/lobby-settings", { method: "GET" });
    expect(get.status).toBe(403);
    const put = await http.request("/api/admin/lobby-settings", {
      method: "PUT",
      body: JSON.stringify({ maxOpenTables: 5 }),
    });
    expect(put.status).toBe(403);
  });
});
