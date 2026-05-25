/**
 * Integration-Test: Lobby-Chat-Archivierung (>12 h alt → ArchivedChatMessage).
 *
 * Spec verlangt eine separate Archiv-Tabelle, kein pures DELETE. Wir
 * verifizieren:
 *   1. Frische Lobby-Nachrichten bleiben unangetastet.
 *   2. Lobby-Nachrichten älter als die Retention (12 h) wandern transaktional
 *      ins `ArchivedChatMessage` und sind aus `ChatMessage` weg.
 *   3. Game-Chat wird NICHT archiviert (bleibt dauerhaft, Spec-Vorgabe).
 *   4. Audit-Eintrag `chat.lobby.archived` ist geschrieben.
 *
 * Wir steuern den Cutoff über das `now`-Argument von `ChatCleanupService.tick`,
 * damit wir nicht mit dem System-Uhrzeit-Cutoff von 12 h hantieren müssen —
 * stattdessen verschieben wir „now" um +13 h, sodass jede frisch eingefügte
 * Nachricht künstlich „alt" ist.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("Lobby-Chat-Archivierung", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  it("alte Lobby-Nachrichten wandern transaktional ins Archiv, frische bleiben", async () => {
    const { userId } = await signUpAndIn(app, {
      email: "chat-archive@jass.local",
      password: "chat-archive-passw0rd-12!",
      name: "chat_archiver",
    });

    // Drei „alte" Lobby-Nachrichten (von vor ~14 h gemessen am späteren
    // Cutoff) + eine „frische".
    const longAgo = new Date("2026-04-01T00:00:00Z");
    await app.prisma.chatMessage.createMany({
      data: [
        {
          channel: "LOBBY",
          channelKey: "lobby:global",
          senderId: userId,
          body: "Hallo zusammen — das ist alt #1.",
          createdAt: longAgo,
        },
        {
          channel: "LOBBY",
          channelKey: "lobby:global",
          senderId: userId,
          body: "Noch eine alte #2.",
          createdAt: longAgo,
        },
        {
          channel: "LOBBY",
          channelKey: "lobby:global",
          senderId: userId,
          body: "Und alte #3.",
          createdAt: longAgo,
        },
      ],
    });
    await app.prisma.chatMessage.create({
      data: {
        channel: "LOBBY",
        channelKey: "lobby:global",
        senderId: userId,
        body: "Frische Nachricht — soll bleiben.",
        // Kein createdAt → DEFAULT now()
      },
    });

    // Auch eine Game-Chat-Nachricht aus der gleichen alten Zeit — die darf
    // NIEMALS archiviert/gelöscht werden (Spec: Game-/DM-Chats dauerhaft).
    // Dafür brauchen wir ein Game; wir legen es minimal direkt an.
    const game = await app.prisma.game.create({
      data: { variant: "KREUZ_4P", ruleVersion: "1.2.0" },
    });
    await app.prisma.chatMessage.create({
      data: {
        channel: "GAME",
        channelKey: `game:${game.id}`,
        senderId: userId,
        body: "Stich-Kommentar — soll dauerhaft bleiben.",
        createdAt: longAgo,
        gameId: game.id,
      },
    });

    // Tick mit „jetzt = April + 13 h" → die drei alten Lobby-Nachrichten
    // werden archiviert (>12 h alt), die frische ist mit der DEFAULT now()
    // (heute 2026-05+) sowieso weit nach dem Cutoff und bleibt.
    const fakeNow = new Date(longAgo.getTime() + 13 * 60 * 60 * 1000);
    const moved = await app.chatCleanup.tick(fakeNow);
    expect(moved).toBe(3);

    // ChatMessage hat noch genau 2 Rows: die frische Lobby + die Game-Chat.
    const remaining = await app.prisma.chatMessage.findMany({
      orderBy: { id: "asc" },
      select: { channel: true, body: true },
    });
    expect(remaining).toHaveLength(2);
    expect(remaining.some((r) => r.channel === "LOBBY" && r.body.includes("Frische"))).toBe(true);
    expect(remaining.some((r) => r.channel === "GAME" && r.body.includes("Stich"))).toBe(true);

    // ArchivedChatMessage hat genau die drei verschobenen Rows.
    const archived = await app.prisma.archivedChatMessage.findMany({
      orderBy: { id: "asc" },
    });
    expect(archived).toHaveLength(3);
    for (const a of archived) {
      expect(a.channel).toBe("LOBBY");
      expect(a.channelKey).toBe("lobby:global");
      expect(a.senderId).toBe(userId);
      expect(a.createdAt.toISOString()).toBe(longAgo.toISOString());
      // archivedAt ist „jetzt-ish" (irgendwo nach dem Test-Start)
      expect(a.archivedAt.getTime()).toBeGreaterThan(longAgo.getTime() + 13 * 60 * 60 * 1000);
    }

    // Audit-Eintrag mit der neuen Action.
    const audit = await app.prisma.auditLog.findFirst({
      where: { action: "chat.lobby.archived" },
    });
    expect(audit, "Audit-Eintrag fehlt").not.toBeNull();
    expect((audit?.meta as { archivedCount?: number } | null)?.archivedCount).toBe(3);
  });

  it("ohne alte Lobby-Nachrichten ist tick() ein No-op (0)", async () => {
    const { userId } = await signUpAndIn(app, {
      email: "chat-archive-noop@jass.local",
      password: "chat-archive-noop-passw0rd-12!",
      name: "chat_noop",
    });
    await app.prisma.chatMessage.create({
      data: {
        channel: "LOBBY",
        channelKey: "lobby:global",
        senderId: userId,
        body: "Frische Nachricht.",
      },
    });

    const moved = await app.chatCleanup.tick();
    expect(moved).toBe(0);

    const archived = await app.prisma.archivedChatMessage.count();
    expect(archived).toBe(0);
  });
});
