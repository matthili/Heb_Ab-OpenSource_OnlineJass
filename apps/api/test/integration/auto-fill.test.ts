/**
 * Integration-Test: M6-D Auto-Fill-Sweeper + Timer-Reset.
 *
 * Was hier geprüft wird:
 *   1. Auto-Fill triggert nicht, wenn `lastSeatChangeAt + autoFillSeconds`
 *      noch in der Zukunft liegt.
 *   2. Sobald die Frist abgelaufen ist, füllt der Sweeper leere Sitze mit
 *      dem Tisch-Default-KI-Typ und startet das Spiel.
 *   3. Jeder Spieler-Join setzt `lastSeatChangeAt` neu — der Timer wird
 *      effektiv resettet (User-Entscheidung 1).
 *   4. Tische mit `autoFillSeconds: null` werden NIEMALS vom Sweeper
 *      angefasst.
 *   5. POST /api/lobby/tables/:id/start (Owner manuell) überspringt den
 *      Sweeper und startet sofort.
 *
 * **Trick zur Zeit-Manipulation**: Wir kürzen `lastSeatChangeAt` direkt in
 * der DB. Das ist sauberer als `vi.useFakeTimers()`, weil der Sweeper-
 * Logik-Code echte `new Date()`-Aufrufe macht und wir den Zeitstempel
 * deterministisch kontrollieren wollen, ohne in den Service-Code zu greifen.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("M6-D auto-fill sweeper + timer reset", () => {
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

  async function makeUsers(n: number): Promise<SignedInUser[]> {
    const users: SignedInUser[] = [];
    for (let i = 0; i < n; i++) {
      users.push(
        await signUpAndIn(app, {
          email: `auto${i}@jass.local`,
          password: "auto-test-passw0rd-12!",
          name: `auto${i}`,
        })
      );
    }
    return users;
  }

  /** Zieht den `lastSeatChangeAt` um `seconds` Sekunden in die Vergangenheit. */
  async function ageTable(tableId: string, seconds: number): Promise<void> {
    await app.prisma.lobbyTable.update({
      where: { id: tableId },
      data: { lastSeatChangeAt: new Date(Date.now() - seconds * 1000) },
    });
  }

  it("Sweeper-tick vor Fälligkeit: kein Auto-Fill", async () => {
    const [owner] = await makeUsers(1);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN", autoFillSeconds: 30 }),
    });
    const tableId = created.body.tableId;

    // Frisch geöffnet → noch nicht fällig.
    const processed = await app.autoFill.tick();
    expect(processed).not.toContain(tableId);

    const dbTable = await app.prisma.lobbyTable.findUnique({ where: { id: tableId } });
    expect(dbTable?.status).toBe("WAITING");
    expect(dbTable?.currentGameId).toBeNull();
  });

  it("Sweeper-tick nach Fälligkeit: Auto-Fill + Spielstart", async () => {
    const [owner] = await makeUsers(1);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN", autoFillSeconds: 30, aiSeatType: "random" }),
    });
    const tableId = created.body.tableId;

    // Fälligkeit erzwingen: lastSeatChangeAt -31s.
    await ageTable(tableId, 31);
    const processed = await app.autoFill.tick();
    expect(processed).toContain(tableId);

    const dbTable = await app.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: { seats: true },
    });
    expect(dbTable?.status).toBe("IN_GAME");
    expect(dbTable?.currentGameId).not.toBeNull();
    expect(dbTable?.seats).toHaveLength(4);
    // 3 KI-Sitze + 1 Owner-Sitz
    expect(dbTable?.seats.filter((s) => s.aiSeatType === "random")).toHaveLength(3);
    expect(dbTable?.seats.filter((s) => s.userId !== null)).toHaveLength(1);

    // Audit-Log: start.auto
    const audits = await app.prisma.auditLog.findMany({
      where: { action: "lobby.table.start.auto", target: tableId },
    });
    expect(audits).toHaveLength(1);
  });

  it("Spieler-Join setzt den Timer zurück", async () => {
    const [owner, p1] = await makeUsers(2);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN", autoFillSeconds: 30 }),
    });
    const tableId = created.body.tableId;

    // Tisch um 25s altern lassen — noch nicht fällig (autoFillSeconds=30).
    await ageTable(tableId, 25);
    let processed = await app.autoFill.tick();
    expect(processed).not.toContain(tableId);

    // p1 joint → Timer-Reset.
    await p1!.http.request(`/api/lobby/tables/${tableId}/join`, { method: "POST" });

    // Jetzt 25s in die Vergangenheit projizieren ist NICHT mehr genug,
    // weil der Join `lastSeatChangeAt` auf jetzt gesetzt hat.
    await ageTable(tableId, 25);
    processed = await app.autoFill.tick();
    expect(processed).not.toContain(tableId);
    const stillWaiting = await app.prisma.lobbyTable.findUnique({
      where: { id: tableId },
    });
    expect(stillWaiting?.status).toBe("WAITING");

    // Erst nach weiteren 6s (= 31s seit dem Join) wird's fällig.
    await ageTable(tableId, 31);
    processed = await app.autoFill.tick();
    expect(processed).toContain(tableId);
  });

  it("autoFillSeconds=null → Sweeper ignoriert den Tisch komplett", async () => {
    const [owner] = await makeUsers(1);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN", autoFillSeconds: null }),
    });
    const tableId = created.body.tableId;

    // Beliebig weit altern lassen — Sweeper tut nichts.
    await ageTable(tableId, 99999);
    const processed = await app.autoFill.tick();
    expect(processed).not.toContain(tableId);

    const dbTable = await app.prisma.lobbyTable.findUnique({ where: { id: tableId } });
    expect(dbTable?.status).toBe("WAITING");
  });

  it("POST /tables/:id/start: Owner überspringt den Timer manuell", async () => {
    const [owner] = await makeUsers(1);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN", autoFillSeconds: 30 }),
    });
    const tableId = created.body.tableId;

    const start = await owner!.http.request<{ gameId: string }>(
      `/api/lobby/tables/${tableId}/start`,
      { method: "POST" }
    );
    expect(start.status).toBe(201);
    expect(start.body.gameId).toBeTruthy();

    const dbTable = await app.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: { seats: true },
    });
    expect(dbTable?.status).toBe("IN_GAME");
    expect(dbTable?.seats).toHaveLength(4);
  });

  it("manueller Start als Nicht-Owner: 403", async () => {
    const [owner, other] = await makeUsers(2);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN" }),
    });
    const tableId = created.body.tableId;
    const start = await other!.http.request(`/api/lobby/tables/${tableId}/start`, {
      method: "POST",
    });
    expect(start.status).toBe(403);
  });
});
