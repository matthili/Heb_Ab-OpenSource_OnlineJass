/**
 * Integration-Test für die Friends-Endpoints: request → accept → list →
 * remove. Eckfälle: doppelte Anfrage, Anfrage an sich selbst, Annehmen
 * ohne offene Anfrage.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("Friends-Flow", () => {
  let app: TestAppHandle;
  let alice: SignedInUser;
  let bob: SignedInUser;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
    alice = await signUpAndIn(app, {
      email: "alice@jass.local",
      password: "password-12-chars",
      name: "alice",
    });
    bob = await signUpAndIn(app, {
      email: "bob@jass.local",
      password: "password-12-chars",
      name: "bob",
    });
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  it("Vollständiger Flow: request → accept → list zeigt befreundet → remove → wieder NONE", async () => {
    // alice → bob: Request
    const req = await alice.http.request(`/api/users/${bob.userId}/friend-request`, {
      method: "POST",
    });
    expect(req.status).toBe(201);

    // Status aus beiden Sichten
    const aStatus = await alice.http.request(`/api/users/${bob.userId}/friend-status`);
    expect((aStatus.body as { status: string }).status).toBe("PENDING_OUT");
    const bStatus = await bob.http.request(`/api/users/${alice.userId}/friend-status`);
    expect((bStatus.body as { status: string }).status).toBe("PENDING_IN");

    // bob nimmt an
    const acc = await bob.http.request(`/api/users/${alice.userId}/friend-accept`, {
      method: "POST",
    });
    expect(acc.status).toBe(201);

    // Beide sehen sich als befreundet
    const list = await alice.http.request("/api/users/me/friends");
    expect(list.status).toBe(200);
    const body = list.body as {
      accepted: { id: string; name: string }[];
      pendingIn: unknown[];
      pendingOut: unknown[];
    };
    expect(body.accepted).toHaveLength(1);
    expect(body.accepted[0]?.id).toBe(bob.userId);
    expect(body.pendingIn).toHaveLength(0);
    expect(body.pendingOut).toHaveLength(0);

    // alice entfreundet
    const del = await alice.http.request(`/api/users/${bob.userId}/friend`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);

    // Status wieder NONE
    const after = await alice.http.request(`/api/users/${bob.userId}/friend-status`);
    expect((after.body as { status: string }).status).toBe("NONE");
  });

  it("Doppelte Anfrage in gleiche Richtung ist no-op (idempotent)", async () => {
    const r1 = await alice.http.request(`/api/users/${bob.userId}/friend-request`, {
      method: "POST",
    });
    expect(r1.status).toBe(201);
    const r2 = await alice.http.request(`/api/users/${bob.userId}/friend-request`, {
      method: "POST",
    });
    expect(r2.status).toBe(201);

    const status = await alice.http.request(`/api/users/${bob.userId}/friend-status`);
    expect((status.body as { status: string }).status).toBe("PENDING_OUT");
  });

  it("Selbst-Freundschaft wird abgelehnt", async () => {
    const r = await alice.http.request(`/api/users/${alice.userId}/friend-request`, {
      method: "POST",
    });
    expect(r.status).toBe(400);
  });

  it("Accept ohne offene Anfrage liefert 400", async () => {
    const r = await alice.http.request(`/api/users/${bob.userId}/friend-accept`, {
      method: "POST",
    });
    expect(r.status).toBe(400);
  });

  it("Anfrage zurückziehen: PENDING_OUT → NONE; bob sieht keine Anfrage mehr", async () => {
    await alice.http.request(`/api/users/${bob.userId}/friend-request`, {
      method: "POST",
    });
    const del = await alice.http.request(`/api/users/${bob.userId}/friend`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);

    const bobList = await bob.http.request("/api/users/me/friends");
    expect((bobList.body as { pendingIn: unknown[] }).pendingIn).toHaveLength(0);
  });

  it("Wenn bob bereits angefragt hat, kriegt alice einen Hinweis, anzunehmen statt zu antworten", async () => {
    await bob.http.request(`/api/users/${alice.userId}/friend-request`, {
      method: "POST",
    });
    const r = await alice.http.request(`/api/users/${bob.userId}/friend-request`, {
      method: "POST",
    });
    expect(r.status).toBe(409);
  });
});
