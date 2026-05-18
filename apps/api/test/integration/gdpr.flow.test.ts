/**
 * Integration-Test M10-C/D: Datenexport + Soft-Delete.
 *
 * Wir bauen einen User mit Profil, Game-Teilnahme und Chat-Nachrichten,
 * exportieren die Daten, und löschen den Account anschließend mit
 * `softDelete`. Verifiziert:
 *   - Export enthält alle Sektionen (account, profile, games, chat, audit,
 *     friendships, sessions)
 *   - Token-Hash in Sessions, kein Klartext-Token
 *   - softDelete anonymisiert User-Felder, leert das Profile, löscht
 *     Sessions/Accounts, behält GameSeats für Mitspieler-Statistiken
 *   - Chat-Nachrichten werden auf "[gelöscht]" gesetzt
 *   - Audit-Log enthält user.gdpr.export + user.gdpr.delete
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GameService, SeatAssignment } from "../../src/modules/game/game.service.js";
import type { GdprService } from "../../src/modules/users/gdpr.service.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("M10-C/D — DSGVO-Datenexport + Soft-Delete", () => {
  let app: TestAppHandle;
  let games: GameService;
  let gdpr: GdprService;

  beforeAll(async () => {
    app = await setupTestApp();
    games = app.games;
    gdpr = app.gdpr;
  });

  beforeEach(async () => {
    await app.resetData();
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  it("exportiert alle Sektionen, Token werden als Hash exportiert", async () => {
    const me = await app.prisma.user.create({
      data: {
        email: "gdpr-tester@example.com",
        name: "GDPR Tester",
        emailVerified: true,
      },
    });
    await app.prisma.profile.create({
      data: {
        userId: me.id,
        realFirstName: "Max",
        city: "Bregenz",
        visibility: { realFirstName: "PRIVATE", city: "FRIENDS" },
      },
    });
    await app.prisma.session.create({
      data: {
        id: "sess-1",
        userId: me.id,
        expiresAt: new Date(Date.now() + 86400 * 1000),
        token: "super-secret-token-do-not-leak",
        userAgent: "vitest",
        ipAddress: "127.0.0.1",
      },
    });
    await app.prisma.chatMessage.create({
      data: {
        channel: "LOBBY",
        channelKey: "lobby:global",
        senderId: me.id,
        body: "Hallo Lobby!",
      },
    });
    await app.prisma.auditLog.create({
      data: { actorId: me.id, action: "auth.login", target: me.id },
    });

    // Ein Spiel mitspielen (Sitz 0).
    const variant = { mode: "TRUMPF" as const, trump_suit: "EICHEL" as const };
    const seats: SeatAssignment[] = [
      { seat: 0, userId: me.id, aiSeatType: null },
      { seat: 1, userId: null, aiSeatType: "random" },
      { seat: 2, userId: null, aiSeatType: "random" },
      { seat: 3, userId: null, aiSeatType: "random" },
    ];
    const { gameId } = await games.createGame({
      variant,
      announcement: { variant, slalom: false },
      starter: 0,
      seats,
      rngSeed: 0x42,
    });

    const data = await gdpr.exportAllData(me.id);
    expect(data.meta.userId).toBe(me.id);
    expect(data.meta.exportVersion).toBe(1);
    expect(data.account.email).toBe("gdpr-tester@example.com");
    expect(data.profile?.realFirstName).toBe("Max");
    expect(data.profile?.city).toBe("Bregenz");

    expect(data.games).toHaveLength(1);
    expect(data.games[0]?.gameId).toBe(gameId);
    expect(data.games[0]?.mySeat).toBe(0);
    // Game ist noch nicht gespielt → 0 Moves
    expect(data.games[0]?.moves).toEqual([]);

    expect(data.chatMessages).toHaveLength(1);
    expect(data.chatMessages[0]?.body).toBe("Hallo Lobby!");

    expect(data.auditEntries).toHaveLength(1);

    expect(data.sessions).toHaveLength(1);
    // Klartext-Token darf NIE im Export landen.
    const exportJson = JSON.stringify(data);
    expect(exportJson).not.toContain("super-secret-token-do-not-leak");
    // Aber der Hash schon.
    expect(data.sessions[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    // Audit-Log bekommt einen Export-Eintrag dazu.
    const post = await app.prisma.auditLog.findMany({
      where: { actorId: me.id, action: "user.gdpr.export" },
    });
    expect(post).toHaveLength(1);
  });

  it("softDelete anonymisiert User + Profil, behält GameSeats, redacted Chat", async () => {
    const me = await app.prisma.user.create({
      data: {
        email: "delete-me@example.com",
        name: "Delete Me",
        emailVerified: true,
      },
    });
    await app.prisma.profile.create({
      data: {
        userId: me.id,
        realFirstName: "Anton",
        realLastName: "Müller",
        city: "Dornbirn",
      },
    });
    await app.prisma.session.create({
      data: {
        id: "sess-d",
        userId: me.id,
        expiresAt: new Date(Date.now() + 86400 * 1000),
        token: "tok",
      },
    });
    await app.prisma.account.create({
      data: {
        id: "acc-d",
        userId: me.id,
        accountId: me.id,
        providerId: "credential",
        password: "argon-hash-stub",
      },
    });
    await app.prisma.chatMessage.create({
      data: {
        channel: "LOBBY",
        channelKey: "lobby:global",
        senderId: me.id,
        body: "Geheimer Inhalt",
      },
    });

    // Einen Game-Seat anlegen, der nach softDelete bestehen MUSS, damit
    // die Spiel-Historie der Mitspieler intakt bleibt.
    const variant = { mode: "TRUMPF" as const, trump_suit: "EICHEL" as const };
    const { gameId } = await games.createGame({
      variant,
      announcement: { variant, slalom: false },
      starter: 0,
      seats: [
        { seat: 0, userId: me.id, aiSeatType: null },
        { seat: 1, userId: null, aiSeatType: "random" },
        { seat: 2, userId: null, aiSeatType: "random" },
        { seat: 3, userId: null, aiSeatType: "random" },
      ],
      rngSeed: 1,
    });

    await gdpr.softDelete(me.id);

    const after = await app.prisma.user.findUnique({
      where: { id: me.id },
      include: { profile: true, sessions: true, accounts: true },
    });
    expect(after?.status).toBe("DELETED_SOFT");
    expect(after?.deletedAt).not.toBeNull();
    expect(after?.email).toMatch(/^deleted-[a-f0-9]+@example\.invalid$/);
    expect(after?.name).toMatch(/^anonym-[a-f0-9]+$/);
    expect(after?.profile?.realFirstName).toBeNull();
    expect(after?.profile?.city).toBeNull();
    expect(after?.sessions).toHaveLength(0);
    expect(after?.accounts).toHaveLength(0);

    // GameSeat bleibt — Spiel-Historie der Mitspieler intakt.
    const seat = await app.prisma.gameSeat.findFirst({
      where: { gameId, seat: 0 },
    });
    expect(seat?.userId).toBe(me.id);

    // Chat-Body redacted.
    const chat = await app.prisma.chatMessage.findFirst({
      where: { senderId: me.id },
    });
    expect(chat?.body).toBe("[gelöscht]");

    // Idempotent: zweiter Aufruf wirft nicht.
    await expect(gdpr.softDelete(me.id)).resolves.toBeUndefined();

    // Audit-Log enthält user.gdpr.delete.
    const audit = await app.prisma.auditLog.findMany({
      where: { actorId: me.id, action: "user.gdpr.delete" },
    });
    expect(audit).toHaveLength(1);
  });
});
