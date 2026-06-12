/**
 * Integration-Test: DM-Send-Guard gegen die echte DB (PN-Empfangsrechte).
 *
 * Deckt den vollen HTTP-Pfad ab (Session-Cookie → SessionGuard → ChatService):
 *   1. `dmPolicy=FRIENDS` blockt einen Fremden (403) — Freund darf (201).
 *   2. Per-Sender-`DmBlock` blockt einen zuvor erlaubten Sender (403),
 *      Aufheben erlaubt wieder (201).
 *   3. `GET /api/chat/can-dm/:id` ist konsistent zum tatsächlichen Send-Verhalten.
 *
 * Ergänzt den isolierten Unit-Test `chat-can-dm.test.ts` um den realen
 * Persistenz- + Guard-Pfad (Profile.dmPolicy / DmBlock / Friendship in PG).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("DM-Send-Guard (PN-Empfangsrechte) — HTTP-Integration", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });
  beforeEach(async () => {
    await app.resetData();
  });

  it("dmPolicy=FRIENDS: Fremder wird mit 403 geblockt, Freund darf senden", async () => {
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

    // Bob: „nur Freunde dürfen mir schreiben".
    const patch = await bob.http.request("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify({ dmPolicy: "FRIENDS" }),
    });
    expect(patch.status).toBe(200);

    // Alice (kein Freund) → can-dm sagt nein, Send wird mit 403 abgelehnt.
    expect(await canDm(alice, bob.userId)).toEqual({ allowed: false, reason: "DM_FRIENDS_ONLY" });
    const blocked = await sendDm(alice, bob.userId, "Hallo Bob!");
    expect(blocked.status).toBe(403);

    // Freundschaft schließen → jetzt erlaubt.
    await makeFriends(alice, bob);
    expect(await canDm(alice, bob.userId)).toEqual({ allowed: true, reason: null });
    const ok = await sendDm(alice, bob.userId, "Jetzt sind wir Freunde!");
    expect(ok.status).toBe(201);
  });

  it("DmBlock: blockt einen zuvor erlaubten Sender; Aufheben erlaubt wieder", async () => {
    const carol = await signUpAndIn(app, {
      email: "carol@jass.local",
      password: "carol-passw0rd-12!",
      name: "carol",
    });
    const dave = await signUpAndIn(app, {
      email: "dave@jass.local",
      password: "dave-passw0rd-12!",
      name: "dave",
    });

    // Default dmPolicy=ALL → carol darf dave initial schreiben.
    expect(await canDm(carol, dave.userId)).toEqual({ allowed: true, reason: null });
    expect((await sendDm(carol, dave.userId, "Hi Dave")).status).toBe(201);

    // Dave entzieht carol die PN-Erlaubnis (DmBlock).
    const block = await dave.http.request(`/api/chat/dm-blocks/${carol.userId}`, {
      method: "POST",
    });
    expect(block.status).toBe(201);

    // Jetzt 403 — DmBlock überschreibt die ALL-Policy.
    expect(await canDm(carol, dave.userId)).toEqual({ allowed: false, reason: "DM_BLOCKED" });
    expect((await sendDm(carol, dave.userId, "Nochmal?")).status).toBe(403);

    // Dave hebt die Sperre auf → wieder erlaubt.
    const unblock = await dave.http.request(`/api/chat/dm-blocks/${carol.userId}`, {
      method: "DELETE",
    });
    expect(unblock.status).toBe(204);
    expect(await canDm(carol, dave.userId)).toEqual({ allowed: true, reason: null });
    expect((await sendDm(carol, dave.userId, "Wieder da")).status).toBe(201);
  });

  it("DmBlock überschreibt sogar eine bestehende Freundschaft", async () => {
    const eve = await signUpAndIn(app, {
      email: "eve@jass.local",
      password: "eve-passw0rd-12!",
      name: "eve",
    });
    const finn = await signUpAndIn(app, {
      email: "finn@jass.local",
      password: "finn-passw0rd-12!",
      name: "finn",
    });

    await makeFriends(eve, finn);
    // Finn nur-Freunde + trotzdem eve per DmBlock sperren.
    await finn.http.request("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify({ dmPolicy: "FRIENDS" }),
    });
    await finn.http.request(`/api/chat/dm-blocks/${eve.userId}`, { method: "POST" });

    expect(await canDm(eve, finn.userId)).toEqual({ allowed: false, reason: "DM_BLOCKED" });
    expect((await sendDm(eve, finn.userId, "Hey")).status).toBe(403);
  });
});

// ─── Helfer ────────────────────────────────────────────────────────────────

function dmChannelKey(a: string, b: string): string {
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

async function sendDm(
  sender: SignedInUser,
  recipientId: string,
  body: string
): Promise<{ status: number; body: unknown }> {
  return sender.http.request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ channelKey: dmChannelKey(sender.userId, recipientId), body }),
  });
}

async function canDm(
  viewer: SignedInUser,
  otherId: string
): Promise<{ allowed: boolean; reason: string | null }> {
  const r = await viewer.http.request<{ allowed: boolean; reason: string | null }>(
    `/api/chat/can-dm/${otherId}`,
    { method: "GET" }
  );
  expect(r.status).toBe(200);
  return r.body;
}

async function makeFriends(a: SignedInUser, b: SignedInUser): Promise<void> {
  const req = await a.http.request(`/api/users/${b.userId}/friend-request`, { method: "POST" });
  if (req.status !== 201) throw new Error(`friend-request failed: ${req.status}`);
  const acc = await b.http.request(`/api/users/${a.userId}/friend-accept`, { method: "POST" });
  if (acc.status !== 201) throw new Error(`friend-accept failed: ${acc.status}`);
}
