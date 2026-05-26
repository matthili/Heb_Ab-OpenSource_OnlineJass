/**
 * Integration-Test: Web-Push Subscribe/Unsubscribe (Setup-Pfad).
 *
 * Im Test-Env sind die VAPID-Variablen NICHT gesetzt → `PushService.isEnabled`
 * ist `false` und `sendToUser` ist ein No-op. Wir prüfen den Subscribe-CRUD-
 * Flow und dass das Public-Key-Endpunkt `enabled: false` meldet.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createHttpClient } from "./http-client.js";
import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const FAKE_SUB = {
  endpoint: "https://fcm.example.com/wp/abc123-fake",
  keys: { p256dh: "BNxAwzZAa-fakepub-256-key", auth: "fakeauthsecret" },
  userAgent: "Test-Agent",
};

describe("Web-Push Setup", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  it("GET /api/push/public-key liefert publicKey=null, enabled=false (keine VAPID-Keys im Test)", async () => {
    const anon = createHttpClient(app.baseUrl);
    const r = await anon.request<{ publicKey: string | null; enabled: boolean }>(
      "/api/push/public-key",
      { method: "GET" }
    );
    expect(r.status).toBe(200);
    expect(r.body.publicKey).toBeNull();
    expect(r.body.enabled).toBe(false);
  });

  it("Subscribe / Unsubscribe-Flow legt die Zeile an und entfernt sie wieder", async () => {
    const { http, userId } = await signUpAndIn(app, {
      email: "push-user@jass.local",
      password: "push-user-passw0rd-12!",
      name: "push_user",
    });

    const sub = await http.request("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(FAKE_SUB),
    });
    expect(sub.status).toBe(204);

    const rows = await app.prisma.pushSubscription.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint).toBe(FAKE_SUB.endpoint);

    // Idempotent: nochmal subscribe → 204, immer noch genau eine Row.
    const sub2 = await http.request("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(FAKE_SUB),
    });
    expect(sub2.status).toBe(204);
    expect(await app.prisma.pushSubscription.count({ where: { userId } })).toBe(1);

    // Unsubscribe.
    const unsub = await http.request("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: FAKE_SUB.endpoint }),
    });
    expect(unsub.status).toBe(204);
    expect(await app.prisma.pushSubscription.count({ where: { userId } })).toBe(0);
  });

  it("Unsubscribe greift nur die eigenen Subscriptions (kein Hijack)", async () => {
    const alice = await signUpAndIn(app, {
      email: "push-alice@jass.local",
      password: "push-alice-passw0rd-12!",
      name: "push_alice",
    });
    const bob = await signUpAndIn(app, {
      email: "push-bob@jass.local",
      password: "push-bob-passw0rd-12!",
      name: "push_bob",
    });

    // Alice subscribed eine Endpoint-URL.
    await alice.http.request("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(FAKE_SUB),
    });
    // Bob versucht Alices Endpoint zu „unsubscriben".
    const r = await bob.http.request("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: FAKE_SUB.endpoint }),
    });
    expect(r.status).toBe(204); // still — deleteMany trifft 0 Rows, kein Fehler

    expect(await app.prisma.pushSubscription.count({ where: { userId: alice.userId } })).toBe(1);
  });

  it("Subscribe ohne Session → 401/403", async () => {
    const anon = createHttpClient(app.baseUrl);
    const r = await anon.request("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(FAKE_SUB),
    });
    expect([401, 403]).toContain(r.status);
  });
});
