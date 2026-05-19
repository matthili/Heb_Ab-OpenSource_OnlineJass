/**
 * Integration-Test: aktive Sessions-Verwaltung über die HTTP-API.
 *
 * Wir simulieren „Alice loggt sich in Chrome ein, dann nochmal in Edge"
 * indem wir zweimal hintereinander `sign-in/email` mit eigenen Cookie-
 * Jars aufrufen. Das ergibt 2 Session-Rows in der DB.
 *
 * Beweise:
 *   - GET /api/users/me/sessions liefert 2 Einträge, einer als
 *     current markiert
 *   - DELETE /api/users/me/sessions/:sid widerruft die andere
 *   - DELETE /api/users/me/sessions/:current_sid wird mit 403 abgelehnt
 *     (Self-Revoke-Schutz)
 *   - DELETE /api/users/me/sessions (ohne :sid) widerruft alle anderen
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { createHttpClient, type HttpClient } from "./http-client.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("Sessions-Flow", () => {
  let app: TestAppHandle;
  let chrome: SignedInUser;
  let edge: HttpClient;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
    // 1. „Chrome": registrieren, verifizieren, einloggen
    chrome = await signUpAndIn(app, {
      email: "alice@jass.local",
      password: "stable-test-password-12345",
      name: "alice",
    });

    // 2. „Edge": frischen Cookie-Jar, gleicher Account, nur Sign-In
    edge = createHttpClient(app.baseUrl);
    const signIn = await edge.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({
        email: "alice@jass.local",
        password: "stable-test-password-12345",
      }),
    });
    if (signIn.status !== 200) {
      throw new Error(`edge sign-in failed: ${signIn.status}`);
    }
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  it("listSessions zeigt alle aktiven Sessions; current ist die anfragende", async () => {
    const fromChrome = await chrome.http.request("/api/users/me/sessions");
    expect(fromChrome.status).toBe(200);
    const body = fromChrome.body as { sessions: Array<{ id: string; current: boolean }> };
    // Mindestens 2 (chrome+edge); ggf. mehr, weil verify-email
    // autoSignInAfterVerification eine zusätzliche Session anlegt.
    expect(body.sessions.length).toBeGreaterThanOrEqual(2);
    const currents = body.sessions.filter((s) => s.current);
    expect(currents).toHaveLength(1);

    const fromEdge = await edge.request("/api/users/me/sessions");
    const edgeBody = fromEdge.body as { sessions: Array<{ id: string; current: boolean }> };
    const edgeCurrent = edgeBody.sessions.filter((s) => s.current);
    expect(edgeCurrent).toHaveLength(1);
    // Chrome- und Edge-Current müssen verschiedene Sessions sein.
    expect(edgeCurrent[0]?.id).not.toBe(currents[0]?.id);
  });

  it("revoke der Edge-Session macht Edge unauthentifiziert", async () => {
    // Edge-Session-ID identifizieren: die mit current=true aus Edge-Sicht
    const edgeList = (
      (await edge.request("/api/users/me/sessions")).body as {
        sessions: Array<{ id: string; current: boolean }>;
      }
    ).sessions;
    const edgeSessionId = edgeList.find((s) => s.current)!.id;

    // Chrome widerruft diese Session
    const del = await chrome.http.request(`/api/users/me/sessions/${edgeSessionId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);

    // Edge ist nicht mehr authentifiziert
    const edgeProbe = await edge.request("/api/users/me");
    expect(edgeProbe.status).toBeGreaterThanOrEqual(401);

    // Chrome ist weiter authentifiziert
    const chromeProbe = await chrome.http.request("/api/users/me");
    expect(chromeProbe.status).toBe(200);
  });

  it("revoke der EIGENEN aktuellen Session liefert 403", async () => {
    const list = (
      (await chrome.http.request("/api/users/me/sessions")).body as {
        sessions: Array<{ id: string; current: boolean }>;
      }
    ).sessions;
    const myId = list.find((s) => s.current)!.id;

    const del = await chrome.http.request(`/api/users/me/sessions/${myId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(403);
  });

  it("revokeAllOthers entfernt alle anderen Sessions, behält die eigene", async () => {
    const del = await chrome.http.request("/api/users/me/sessions", { method: "DELETE" });
    expect(del.status).toBe(200);
    // Mindestens 1 widerrufen (Edge), ggf. mehr (verify-email-auto-signin).
    expect((del.body as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);

    // Edge ist tot
    const edgeProbe = await edge.request("/api/users/me");
    expect(edgeProbe.status).toBeGreaterThanOrEqual(401);

    // Chrome lebt
    const me = await chrome.http.request("/api/users/me");
    expect(me.status).toBe(200);

    // Nur noch eine Session
    const after = (
      (await chrome.http.request("/api/users/me/sessions")).body as {
        sessions: Array<{ id: string }>;
      }
    ).sessions;
    expect(after).toHaveLength(1);
  });

  it("fremde Session-ID liefert 404 (kein Information-Disclosure)", async () => {
    // Bob registrieren, dessen Session-ID erspähen
    const bob = await signUpAndIn(app, {
      email: "bob@jass.local",
      password: "stable-test-password-12345",
      name: "bob",
    });
    const bobsList = (
      (await bob.http.request("/api/users/me/sessions")).body as {
        sessions: Array<{ id: string }>;
      }
    ).sessions;
    const bobSessionId = bobsList[0]?.id ?? "";

    // Alice versucht bobs Session zu löschen
    const del = await chrome.http.request(`/api/users/me/sessions/${bobSessionId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(404);
  });
});
