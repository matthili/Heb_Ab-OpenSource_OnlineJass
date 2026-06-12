/**
 * Integration-Test: AFK-/Pause-Modus (HTTP gegen echte DB + Redis).
 *
 *   1. Toggle an/aus + persistenter Lesezustand über GET /api/lobby/afk.
 *   2. Guard: AFK an ist verboten, solange man an einem Tisch sitzt (403) —
 *      sonst könnte man eine Partie blockieren.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("AFK-/Pause-Modus — HTTP-Integration", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });
  beforeEach(async () => {
    await app.resetData();
  });

  it("Toggle an/aus, Lesezustand bleibt konsistent", async () => {
    const user = await signUpAndIn(app, {
      email: "afk-anna@jass.local",
      password: "afk-anna-passw0rd-12",
      name: "afkanna",
    });

    expect((await user.http.request("/api/lobby/afk", { method: "GET" })).body).toEqual({
      afk: false,
    });

    const on = await user.http.request("/api/lobby/afk", {
      method: "POST",
      body: JSON.stringify({ afk: true }),
    });
    expect(on.status).toBe(201);
    expect(on.body).toEqual({ afk: true });
    expect((await user.http.request("/api/lobby/afk", { method: "GET" })).body).toEqual({
      afk: true,
    });

    const off = await user.http.request("/api/lobby/afk", {
      method: "POST",
      body: JSON.stringify({ afk: false }),
    });
    expect(off.body).toEqual({ afk: false });
    expect((await user.http.request("/api/lobby/afk", { method: "GET" })).body).toEqual({
      afk: false,
    });
  });

  it("AFK an wird mit 403 abgelehnt, solange man an einem Tisch sitzt", async () => {
    const user = await signUpAndIn(app, {
      email: "afk-ben@jass.local",
      password: "afk-ben-passw0rd-12",
      name: "afkben",
    });

    // Tisch eröffnen → der Owner sitzt jetzt am Tisch.
    const created = await user.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN" }),
    });
    expect(created.status).toBe(201);

    const blocked = await user.http.request("/api/lobby/afk", {
      method: "POST",
      body: JSON.stringify({ afk: true }),
    });
    expect(blocked.status).toBe(403);
    // Status bleibt aus.
    expect((await user.http.request("/api/lobby/afk", { method: "GET" })).body).toEqual({
      afk: false,
    });

    // Tisch verlassen → AFK ist wieder erlaubt.
    await user.http.request(`/api/lobby/tables/${created.body.tableId}/leave`, { method: "POST" });
    const ok = await user.http.request("/api/lobby/afk", {
      method: "POST",
      body: JSON.stringify({ afk: true }),
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ afk: true });
  });
});
