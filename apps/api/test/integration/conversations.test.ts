/**
 * Integration-Test: Profil-Konversations-History.
 *
 * Szenarien:
 *   1. `GET /api/chat/conversations` listet DM-Partner, sortiert nach letztem
 *      Kontakt; jeder Eintrag hat letzte Nachricht + Spiel-Flag.
 *   2. `GET /api/chat/conversations/:otherUserId?filter=all` liefert den
 *      vollständigen DM-Verlauf zwischen beiden User mit Spiel-Kontext.
 *   3. Filter `during-game` / `no-game` schneidet sauber.
 *   4. DMs, die während eines aktiven Spiels gesendet werden, bekommen
 *      automatisch die `gameId` mit dran (`ChatService.send`-Hook).
 *   5. Mitspieler-Liste pro `gameId` enthält die Sitz-Namen (Mensch +
 *      KI-Sitztyp-Label).
 *   6. Self-DM (`?otherUserId === me`) wird mit 403 abgelehnt.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

interface PartnersResponse {
  partners: Array<{
    partner: { id: string; name: string };
    lastMessage: { body: string; createdAt: string; wasDuringGame: boolean };
  }>;
}
interface ConversationResponse {
  messages: Array<{
    id: string;
    senderId: string;
    senderName: string;
    body: string;
    createdAt: string;
    gameId: string | null;
  }>;
  gameContexts: Record<string, { mitspieler: string[] }>;
}

describe("Profil-Konversations-History", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  it("listet DM-Partner mit letzter Nachricht, sortiert nach letztem Kontakt", async () => {
    const alice = await signUpAndIn(app, {
      email: "alice@jass.local",
      password: "alice-passw0rd-12!",
      name: "alice",
    });
    const bob = await signUpAndIn(app, {
      email: "bob@jass.local",
      password: "bob-passw0rd-12!",
      name: "bob",
    });
    const carol = await signUpAndIn(app, {
      email: "carol@jass.local",
      password: "carol-passw0rd-12!",
      name: "carol",
    });

    // alice → bob (älteste), alice → carol (mittel), carol → alice (jüngste).
    await sendDm(alice, bob.userId, "Hallo Bob.");
    await sleep(20);
    await sendDm(alice, carol.userId, "Hallo Carol.");
    await sleep(20);
    await sendDm(carol, alice.userId, "Hi Alice, wir spielen heute Abend?");

    const list = await alice.http.request<PartnersResponse>("/api/chat/conversations", {
      method: "GET",
    });
    expect(list.status).toBe(200);
    expect(list.body.partners).toHaveLength(2);
    expect(list.body.partners[0]?.partner.name).toBe("carol");
    expect(list.body.partners[0]?.lastMessage.body).toContain("heute Abend");
    expect(list.body.partners[1]?.partner.name).toBe("bob");
  });

  it("Konversationsverlauf chronologisch + Filter `during-game` / `no-game`", async () => {
    const alice = await signUpAndIn(app, {
      email: "alice2@jass.local",
      password: "alice2-passw0rd-12!",
      name: "alice2",
    });
    const bob = await signUpAndIn(app, {
      email: "bob2@jass.local",
      password: "bob2-passw0rd-12!",
      name: "bob2",
    });

    // Lobby-DM (kein aktives Spiel).
    await sendDm(alice, bob.userId, "Hi vor dem Spiel.");

    // Alice sitzt jetzt in einem aktiven Spiel mit Bob — und einer KI.
    const game = await app.prisma.game.create({
      data: { variant: "KREUZ_4P", ruleVersion: "1.2.0" },
    });
    await app.prisma.gameSeat.create({
      data: { gameId: game.id, seat: 0, userId: alice.userId },
    });
    await app.prisma.gameSeat.create({
      data: { gameId: game.id, seat: 1, userId: bob.userId },
    });
    await app.prisma.gameSeat.create({
      data: { gameId: game.id, seat: 2, aiSeatType: "heuristic" },
    });

    // DM während des Spiels → bekommt gameId von alice.
    await sleep(20);
    await sendDm(alice, bob.userId, "Bock, das war ein guter Stich!");

    // Spiel beendet, weitere DM ohne Spiel-Kontext.
    await app.prisma.game.update({ where: { id: game.id }, data: { endedAt: new Date() } });
    await sleep(20);
    await sendDm(alice, bob.userId, "Bis morgen!");

    // Alle drei.
    const all = await alice.http.request<ConversationResponse>(
      `/api/chat/conversations/${bob.userId}?filter=all`,
      { method: "GET" }
    );
    expect(all.status).toBe(200);
    expect(all.body.messages).toHaveLength(3);
    expect(all.body.messages.map((m) => m.gameId)).toEqual([null, game.id, null]);
    // Mitspieler-Liste fürs Spiel.
    expect(all.body.gameContexts[game.id]?.mitspieler).toEqual([
      "alice2",
      "bob2",
      "KI (heuristic)",
    ]);

    // Nur „während-Spiel" → eine Nachricht.
    const duringGame = await alice.http.request<ConversationResponse>(
      `/api/chat/conversations/${bob.userId}?filter=during-game`,
      { method: "GET" }
    );
    expect(duringGame.body.messages).toHaveLength(1);
    expect(duringGame.body.messages[0]?.gameId).toBe(game.id);

    // Nur „kein-Spiel" → zwei.
    const noGame = await alice.http.request<ConversationResponse>(
      `/api/chat/conversations/${bob.userId}?filter=no-game`,
      { method: "GET" }
    );
    expect(noGame.body.messages).toHaveLength(2);
    expect(noGame.body.messages.every((m) => m.gameId === null)).toBe(true);
  });

  it("Self-DM (mit eigener User-ID) → 403", async () => {
    const me = await signUpAndIn(app, {
      email: "selfdm@jass.local",
      password: "selfdm-passw0rd-12!",
      name: "selfdm",
    });
    const r = await me.http.request(`/api/chat/conversations/${me.userId}?filter=all`, {
      method: "GET",
    });
    expect(r.status).toBe(403);
  });

  it("Bob sieht den Verlauf aus seiner Sicht symmetrisch", async () => {
    // Sicherstellen, dass der `dm:<a>:<b>`-Key seitenneutral funktioniert.
    const alice = await signUpAndIn(app, {
      email: "alice3@jass.local",
      password: "alice3-passw0rd-12!",
      name: "alice3",
    });
    const bob = await signUpAndIn(app, {
      email: "bob3@jass.local",
      password: "bob3-passw0rd-12!",
      name: "bob3",
    });
    await sendDm(alice, bob.userId, "Hi.");
    await sleep(20);
    await sendDm(bob, alice.userId, "Hallo.");

    const fromBob = await bob.http.request<ConversationResponse>(
      `/api/chat/conversations/${alice.userId}?filter=all`,
      { method: "GET" }
    );
    expect(fromBob.body.messages).toHaveLength(2);
    expect(fromBob.body.messages[0]?.senderName).toBe("alice3");
    expect(fromBob.body.messages[1]?.senderName).toBe("bob3");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Schickt eine DM von `sender` an `recipientId` über den REST-Endpunkt. */
async function sendDm(sender: SignedInUser, recipientId: string, body: string): Promise<void> {
  const channelKey =
    sender.userId < recipientId
      ? `dm:${sender.userId}:${recipientId}`
      : `dm:${recipientId}:${sender.userId}`;
  const r = await sender.http.request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ channelKey, body }),
  });
  if (r.status !== 201) {
    throw new Error(`DM send failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
}
