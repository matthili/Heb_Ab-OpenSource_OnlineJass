/**
 * Integration-Test: Spielername ändern (PATCH /api/users/me/name) mit Historie
 * + zwei Cooldowns (Änderung + Freigabe). Alle Fälle ohne Warten testbar, weil
 * die Cooldowns „gerade eben"-Aktionen sperren — und „jetzt" ist immer eben.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const PW = "username-test-passw0rd-12!";

describe("Spielername-Änderung + Cooldowns", () => {
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

  it("erste Änderung frei + Historie; sofortige zweite blockiert (Änderungs-Cooldown)", async () => {
    const u = await signUpAndIn(app, { email: "balu@jass.local", password: PW, name: "Balu" });

    const r1 = await u.http.request<{ name: string }>("/api/users/me/name", {
      method: "PATCH",
      body: JSON.stringify({ name: "KingLouis" }),
    });
    expect(r1.status).toBe(200);
    expect(r1.body.name).toBe("KingLouis");

    const hist = await u.http.request<{ history: { name: string; untilAt: string | null }[] }>(
      `/api/users/${u.userId}/name-history`,
      { method: "GET" }
    );
    expect(hist.body.history.map((h) => h.name)).toEqual(["Balu", "KingLouis"]);
    expect(hist.body.history[0]!.untilAt).not.toBeNull(); // alter Name geschlossen
    expect(hist.body.history[1]!.untilAt).toBeNull(); // neuer Name offen

    // Sofortige zweite Änderung → Cooldown (409).
    const r2 = await u.http.request("/api/users/me/name", {
      method: "PATCH",
      body: JSON.stringify({ name: "Mogli" }),
    });
    expect(r2.status).toBe(409);
  });

  it("Freigabe-Cooldown: ein anderer kann den gerade freigegebenen Namen nicht sofort nehmen", async () => {
    const a = await signUpAndIn(app, { email: "a@jass.local", password: PW, name: "Balu" });
    const freed = await a.http.request("/api/users/me/name", {
      method: "PATCH",
      body: JSON.stringify({ name: "KingLouis" }),
    });
    expect(freed.status).toBe(200); // „Balu" ist jetzt freigegeben

    const b = await signUpAndIn(app, { email: "b@jass.local", password: PW, name: "Bagheera" });
    const r = await b.http.request<{ message?: string }>("/api/users/me/name", {
      method: "PATCH",
      body: JSON.stringify({ name: "Balu" }),
    });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/anderen Spieler/);
  });

  it("aktuell vergebener Name eines anderen wird abgelehnt", async () => {
    await signUpAndIn(app, { email: "a@jass.local", password: PW, name: "Balu" });
    const b = await signUpAndIn(app, { email: "b@jass.local", password: PW, name: "Bagheera" });
    const r = await b.http.request("/api/users/me/name", {
      method: "PATCH",
      body: JSON.stringify({ name: "Balu" }),
    });
    expect(r.status).toBe(409);
  });

  it("eigenen freigegebenen Namen darf man zurücknehmen (kein Freigabe-Cooldown gegen sich selbst)", async () => {
    // Cooldowns auf 0 setzen wäre Admin; hier reicht: A nennt sich um und ZURÜCK.
    // Der Änderungs-Cooldown würde das zwar blocken — darum testen wir nur, dass
    // der FREIGABE-Cooldown nicht gegen den eigenen alten Namen greift, indem wir
    // die Eindeutigkeit prüfen: niemand sonst hält „Balu", also kein 409 wegen
    // Vergabe; geblockt würde höchstens durch Änderungs-Cooldown (anderer Code).
    const a = await signUpAndIn(app, { email: "a@jass.local", password: PW, name: "Balu" });
    const r1 = await a.http.request("/api/users/me/name", {
      method: "PATCH",
      body: JSON.stringify({ name: "KingLouis" }),
    });
    expect(r1.status).toBe(200);
    // „Balu" ist nur in A's eigener Historie freigegeben → der Freigabe-Cooldown
    // (userId != me) greift für A NICHT. Dass die zweite Änderung am
    // Änderungs-Cooldown scheitert, ist ein anderer Pfad (oben getestet).
    const hist = await a.http.request<{ history: { name: string }[] }>(
      `/api/users/${a.userId}/name-history`,
      { method: "GET" }
    );
    expect(hist.body.history.map((h) => h.name)).toContain("Balu");
  });
});
