/**
 * Integration-Test: M6-B Lobby-Flow (ohne Spiel-Start, der kommt mit M6-C).
 *
 * Szenarien:
 *   1. OPEN-Tisch: Owner öffnet, 3 weitere joinen sofort, Tisch wird voll
 *   2. REQUEST-Tisch: Beitritts-Request → Owner approve → Sitz vergeben
 *   3. REQUEST-Tisch: Beitritts-Request → Owner deny → kein Sitz, Audit-Log
 *   4. INVITE-Tisch: Owner lädt ein, Eingeladener akzeptiert
 *   5. INVITE-Tisch ohne Einladung: 403 beim Join
 *   6. Owner-Wechsel: Owner verlässt, nächster Mensch nach joinOrder wird Owner
 *   7. Letzter Mensch verlässt → Tisch CLOSED
 *
 * Wir testen über die REST-API (echtes HTTP), nicht über den Service direkt
 * — das deckt Controller + Guards + DTO-Validation mit ab.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("M6-B lobby flow", () => {
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

  // Helfer: 4 frische Test-User. Wiederverwendet in mehreren Tests.
  async function makeUsers(n: number): Promise<SignedInUser[]> {
    const users: SignedInUser[] = [];
    for (let i = 0; i < n; i++) {
      users.push(
        await signUpAndIn(app, {
          email: `user${i}@jass.local`,
          password: "lobby-test-passw0rd-12!",
          name: `user${i}`,
        })
      );
    }
    return users;
  }

  it("OPEN: Owner öffnet, drei joinen, Tisch ist voll", async () => {
    const [owner, p1, p2, p3] = await makeUsers(4);

    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN" }),
    });
    expect(created.status).toBe(201);
    const tableId = created.body.tableId;

    for (const u of [p1!, p2!, p3!]) {
      const join = await u.http.request<{ kind: string; seat: number }>(
        `/api/lobby/tables/${tableId}/join`,
        { method: "POST" }
      );
      expect(join.status).toBe(201);
      expect(join.body.kind).toBe("seated");
    }

    // Listing zeigt 4/4
    const list = await owner!.http.request<{ tables: { id: string; seatsTaken: number }[] }>(
      "/api/lobby/tables?status=WAITING",
      { method: "GET" }
    );
    const me = list.body.tables.find((t) => t.id === tableId);
    expect(me?.seatsTaken).toBe(4);
  });

  it("OPEN: voller Tisch lehnt 5. Join mit 409 ab", async () => {
    const [owner, p1, p2, p3, p4] = await makeUsers(5);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN" }),
    });
    const tableId = created.body.tableId;
    for (const u of [p1!, p2!, p3!]) {
      await u.http.request(`/api/lobby/tables/${tableId}/join`, { method: "POST" });
    }
    const fifth = await p4!.http.request(`/api/lobby/tables/${tableId}/join`, {
      method: "POST",
    });
    expect(fifth.status).toBe(409);
  });

  it("REQUEST: approve führt zu seated, deny lässt offen", async () => {
    const [owner, p1, p2] = await makeUsers(3);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "REQUEST" }),
    });
    const tableId = created.body.tableId;

    // p1 stellt Anfrage
    const req1 = await p1!.http.request<{ kind: string; requestId: string }>(
      `/api/lobby/tables/${tableId}/join`,
      { method: "POST" }
    );
    expect(req1.body.kind).toBe("request-pending");
    const reqId1 = req1.body.requestId;

    // Owner sieht ihn im Detail
    const detail = await owner!.http.request<{
      joinRequests?: { id: string; userId: string }[];
    }>(`/api/lobby/tables/${tableId}`, { method: "GET" });
    expect(detail.body.joinRequests).toHaveLength(1);

    // Approve
    const ok = await owner!.http.request<{ seat: number }>(
      `/api/lobby/tables/${tableId}/join-requests/${reqId1}/approve`,
      { method: "POST" }
    );
    expect(ok.status).toBe(201);
    expect(ok.body.seat).toBe(1);

    // p2 stellt Anfrage, Owner lehnt ab
    const req2 = await p2!.http.request<{ requestId: string }>(
      `/api/lobby/tables/${tableId}/join`,
      { method: "POST" }
    );
    const denyRes = await owner!.http.request(
      `/api/lobby/tables/${tableId}/join-requests/${req2.body.requestId}/deny`,
      { method: "POST" }
    );
    expect(denyRes.status).toBe(201);

    // p2 versucht nochmal zu joinen → neuer Request (alter ist DENIED).
    const req3 = await p2!.http.request<{ kind: string }>(`/api/lobby/tables/${tableId}/join`, {
      method: "POST",
    });
    expect(req3.body.kind).toBe("request-pending");
  });

  it("INVITE: nur eingeladene können joinen", async () => {
    const [owner, invitee, stranger] = await makeUsers(3);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "INVITE" }),
    });
    const tableId = created.body.tableId;

    // Stranger versucht zu joinen → 403
    const strangerJoin = await stranger!.http.request(`/api/lobby/tables/${tableId}/join`, {
      method: "POST",
    });
    expect(strangerJoin.status).toBe(403);

    // Owner lädt invitee ein
    const inv = await owner!.http.request<{ inviteId: string }>(
      `/api/lobby/tables/${tableId}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ inviteeUserId: invitee!.userId }),
      }
    );
    expect(inv.status).toBe(201);

    // Invitee joint → Sitz 1
    const inviteeJoin = await invitee!.http.request<{ kind: string; seat: number }>(
      `/api/lobby/tables/${tableId}/join`,
      { method: "POST" }
    );
    expect(inviteeJoin.body.kind).toBe("invite-used");
    expect(inviteeJoin.body.seat).toBe(1);
  });

  it("Owner-Wechsel: ältester verbleibender Mensch wird Owner; bei leerem Tisch CLOSED", async () => {
    const [owner, p1, p2] = await makeUsers(3);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({ joinMode: "OPEN" }),
    });
    const tableId = created.body.tableId;
    await p1!.http.request(`/api/lobby/tables/${tableId}/join`, { method: "POST" });
    await p2!.http.request(`/api/lobby/tables/${tableId}/join`, { method: "POST" });

    // Owner verlässt → p1 (joinOrder=1) wird Owner.
    const leave1 = await owner!.http.request<{
      seatFreed: number;
      newOwnerId: string | null;
      tableClosed: boolean;
    }>(`/api/lobby/tables/${tableId}/leave`, { method: "POST" });
    expect(leave1.body.newOwnerId).toBe(p1!.userId);
    expect(leave1.body.tableClosed).toBe(false);

    // p1 verlässt → p2 wird Owner.
    const leave2 = await p1!.http.request<{ newOwnerId: string | null; tableClosed: boolean }>(
      `/api/lobby/tables/${tableId}/leave`,
      { method: "POST" }
    );
    expect(leave2.body.newOwnerId).toBe(p2!.userId);

    // p2 (jetzt Owner, allein) verlässt → Tisch CLOSED.
    const leave3 = await p2!.http.request<{ tableClosed: boolean }>(
      `/api/lobby/tables/${tableId}/leave`,
      { method: "POST" }
    );
    expect(leave3.body.tableClosed).toBe(true);

    // Tisch ist in DB als CLOSED
    const dbTable = await app.prisma.lobbyTable.findUnique({ where: { id: tableId } });
    expect(dbTable?.status).toBe("CLOSED");
    expect(dbTable?.closedAt).not.toBeNull();
  });

  it("Owner kann mit KI-Sitzen direkt 4-voll öffnen", async () => {
    const [owner] = await makeUsers(1);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        aiSeatType: "random",
        initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
      }),
    });
    const tableId = created.body.tableId;
    const detail = await owner!.http.request<{ seatsTaken: number; seats: { isEmpty: boolean }[] }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    expect(detail.body.seatsTaken).toBe(4);
    expect(detail.body.seats.every((s) => !s.isEmpty)).toBe(true);
  });
});
