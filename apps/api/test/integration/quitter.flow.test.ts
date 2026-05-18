/**
 * Integration-Test Quitter-Sprint:
 *   1. User steigt aus laufendem Spiel aus → GameSeat.leftAt gesetzt,
 *      LobbyTableSeat auf KI umgeschaltet, Audit-Eintrag mit
 *      hadHumanOpponents korrekt
 *   2. Spiel läuft danach ohne ihn weiter (KI übernimmt seinen Sitz)
 *   3. Aussteiger kann keinen Move/keine Ansage mehr machen
 *   4. AdminService.listQuitters aggregiert die Audit-Einträge korrekt
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminService } from "../../src/modules/admin/admin.service.js";
import type { GameService, SeatAssignment } from "../../src/modules/game/game.service.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";
import { signUpAndIn } from "./auth-helper.js";

describe("Quitter-Sprint — Aussteig aus laufendem Spiel", () => {
  let app: TestAppHandle;
  let games: GameService;
  let admin: AdminService;

  beforeAll(async () => {
    app = await setupTestApp();
    games = app.games;
    admin = app.admin;
  });

  beforeEach(async () => {
    await app.resetData();
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  it("Solo-User steigt aus → hadHumanOpponents=false, Spiel läuft mit 3 KIs+1 KI-Ersatz weiter", async () => {
    const user = await signUpAndIn(app, {
      email: "q1@jass.local",
      password: "quitter-pw-12!",
      name: "q1",
    });

    // Tisch aufmachen, Auto-Start
    const created = await user.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
      }),
    });
    const tableId = created.body.tableId;
    const detail = await user.http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    const gameId = detail.body.currentGameId!;
    expect(gameId).toBeTruthy();

    // Aussteig — Solo-Tisch: keine Menschen mehr → Tisch wird sofort
    // geschlossen, Spiel server-seitig zu Ende getrieben (driveAIsToEnd).
    const res = await user.http.request<{ seatFreed: number | null; tableClosed: boolean }>(
      `/api/lobby/tables/${tableId}/leave`,
      { method: "POST" }
    );
    expect(res.status).toBe(201);
    expect(res.body.tableClosed).toBe(true);

    // GameSeat.leftAt sollte gesetzt sein
    const seat = await app.prisma.gameSeat.findFirst({
      where: { gameId, userId: user.userId },
    });
    expect(seat?.leftAt).not.toBeNull();
    expect(seat?.replacedByAiSeatType).toBeTruthy();

    // LobbyTableSeat ist auf KI umgeschaltet
    const lobbySeat = await app.prisma.lobbyTableSeat.findFirst({
      where: { tableId, seat: seat!.seat },
    });
    expect(lobbySeat?.userId).toBeNull();
    expect(lobbySeat?.aiSeatType).toBeTruthy();

    // Audit-Eintrag mit hadHumanOpponents=false (Solo-Tisch, andere 3 sind KI)
    const audit = await app.prisma.auditLog.findFirst({
      where: { actorId: user.userId, action: "game.abandoned" },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.meta as { hadHumanOpponents?: boolean };
    expect(meta.hadHumanOpponents).toBe(false);

    // Tisch ist CLOSED, Spiel zu Ende.
    const tableAfter = await app.prisma.lobbyTable.findUnique({ where: { id: tableId } });
    expect(tableAfter?.status).toBe("CLOSED");
    expect(tableAfter?.closedAt).not.toBeNull();

    const gameAfter = await app.prisma.game.findUnique({ where: { id: gameId } });
    expect(gameAfter?.endedAt).not.toBeNull();
    expect(gameAfter?.finalScore).not.toBeNull();
  });

  it("Aussteiger kann keinen Move mehr machen (findSeatForUser ignoriert leftAt)", async () => {
    const user = await signUpAndIn(app, {
      email: "q2@jass.local",
      password: "quitter-pw-12!",
      name: "q2",
    });
    const created = await user.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
      }),
    });
    const tableId = created.body.tableId;
    const detail = await user.http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    const gameId = detail.body.currentGameId!;

    await games.markUserLeft(gameId, user.userId);

    await expect(
      games.playMoveAsUser(gameId, user.userId, { suit: "EICHEL", rank: "ASS" })
    ).rejects.toThrow(/sitzt nicht an Tisch/i);
  });

  it("Tisch mit 2 Menschen: hadHumanOpponents=true beim Aussteig", async () => {
    // Wir simulieren das auf Service-Ebene, weil 2-User-Tische via REST
    // einen Join-Flow brauchen, der hier zuviel Setup wäre.
    const a = await signUpAndIn(app, {
      email: "qa@jass.local",
      password: "pw-12-letters!",
      name: "qa",
    });
    const b = await signUpAndIn(app, {
      email: "qb@jass.local",
      password: "pw-12-letters!",
      name: "qb",
    });
    const seats: SeatAssignment[] = [
      { seat: 0, userId: a.userId, aiSeatType: null },
      { seat: 1, userId: b.userId, aiSeatType: null },
      { seat: 2, userId: null, aiSeatType: "heuristic" },
      { seat: 3, userId: null, aiSeatType: "heuristic" },
    ];
    const { gameId } = await games.createGame({ seats, rngSeed: 7 });

    const meta = await games.markUserLeft(gameId, a.userId);
    expect(meta.hadHumanOpponents).toBe(true);

    const audit = await app.prisma.auditLog.findFirst({
      where: { actorId: a.userId, action: "game.abandoned" },
    });
    expect((audit!.meta as { hadHumanOpponents?: boolean }).hadHumanOpponents).toBe(true);

    // b ist noch dabei
    void b;
  });

  it("AdminService.listQuitters: sortiert nach withHumans, dann nach total", async () => {
    const u1 = await signUpAndIn(app, {
      email: "qu1@jass.local",
      password: "pw-12-letters!",
      name: "qu1",
    });
    const u2 = await signUpAndIn(app, {
      email: "qu2@jass.local",
      password: "pw-12-letters!",
      name: "qu2",
    });
    // u1: 1 Aussteig mit Menschen, 0 ohne → withHumans=1, total=1
    // u2: 0 mit Menschen, 3 ohne → withHumans=0, total=3
    // → u1 muss vor u2 erscheinen
    await app.prisma.auditLog.createMany({
      data: [
        { actorId: u1.userId, action: "game.abandoned", meta: { hadHumanOpponents: true } },
        { actorId: u2.userId, action: "game.abandoned", meta: { hadHumanOpponents: false } },
        { actorId: u2.userId, action: "game.abandoned", meta: { hadHumanOpponents: false } },
        { actorId: u2.userId, action: "game.abandoned", meta: { hadHumanOpponents: false } },
      ],
    });
    const list = await admin.listQuitters(10);
    expect(list).toHaveLength(2);
    expect(list[0]?.userId).toBe(u1.userId);
    expect(list[0]?.withHumans).toBe(1);
    expect(list[0]?.total).toBe(1);
    expect(list[1]?.userId).toBe(u2.userId);
    expect(list[1]?.withHumans).toBe(0);
    expect(list[1]?.total).toBe(3);
  });
});
