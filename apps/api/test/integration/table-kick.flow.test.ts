/**
 * Integration-Test: Owner wirft einen Mitspieler vom Tisch und sperrt ihn für
 * diese Tisch-ID (`POST /api/lobby/tables/:id/kick`).
 *
 * Prüft:
 *   - Kick in der Warte-Phase → Sitz wird frei.
 *   - `TableBan`-Eintrag entsteht.
 *   - Erneuter Beitritt des Gesperrten wird mit 403 abgelehnt.
 *   - Nicht-Owner darf nicht kicken (403).
 *
 * Der Auto-Fill-Sweeper ist im Test deaktiviert (DISABLE_AUTO_FILL_SWEEPER=1),
 * der Tisch bleibt also in WAITING, ohne von selbst zu starten.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("Tisch-Kick + Sperre", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  it("Owner kickt Mitspieler in WAITING → Sitz frei, Bann, Rejoin abgelehnt", async () => {
    const owner = await signUpAndIn(app, {
      email: "kick-owner@jass.local",
      password: "kick-passw0rd-12!",
      name: "Owner",
    });
    const player = await signUpAndIn(app, {
      email: "kick-player@jass.local",
      password: "kick-passw0rd-12!",
      name: "Player",
    });

    // Owner öffnet einen offenen Kreuz-Tisch (Owner sitzt automatisch).
    const create = await owner.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN", variant: "KREUZ_4P" }),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const tableId = create.body.tableId;

    // Player tritt bei → bekommt einen Sitz.
    const join = await player.http.request<{ kind: string; seat?: number }>(
      `/api/lobby/tables/${tableId}/join`,
      { method: "POST" }
    );
    expect([200, 201], JSON.stringify(join.body)).toContain(join.status);
    expect(join.body.kind).toBe("seated");

    // Owner wirft den Player raus.
    const kick = await owner.http.request<unknown>(`/api/lobby/tables/${tableId}/kick`, {
      method: "POST",
      body: JSON.stringify({ userId: player.userId }),
    });
    expect([200, 201], JSON.stringify(kick.body)).toContain(kick.status);

    // Sitz ist frei.
    const seats = await app.prisma.lobbyTableSeat.findMany({
      where: { tableId, userId: player.userId },
    });
    expect(seats).toHaveLength(0);

    // Bann existiert.
    const ban = await app.prisma.tableBan.findUnique({
      where: { tableId_userId: { tableId, userId: player.userId } },
    });
    expect(ban).not.toBeNull();
    expect(ban?.byUserId).toBe(owner.userId);

    // Erneuter Beitritt → 403.
    const rejoin = await player.http.request<unknown>(`/api/lobby/tables/${tableId}/join`, {
      method: "POST",
    });
    expect(rejoin.status).toBe(403);

    // Nicht-Owner darf nicht kicken → 403.
    const other = await signUpAndIn(app, {
      email: "kick-other@jass.local",
      password: "kick-passw0rd-12!",
      name: "Other",
    });
    const forbidden = await other.http.request<unknown>(`/api/lobby/tables/${tableId}/kick`, {
      method: "POST",
      body: JSON.stringify({ userId: owner.userId }),
    });
    expect(forbidden.status).toBe(403);
  });
});
