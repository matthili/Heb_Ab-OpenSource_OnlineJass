/**
 * Integration-Test: Chat-Wortfilter (Admin-CRUD + Maskierung in der Live-Nachricht).
 *
 * Szenarien:
 *   1. Admin pflegt die Wortliste via REST (`POST/GET/DELETE /api/admin/banned-words`).
 *   2. Eine Lobby-Nachricht mit einem gebannten Wort wird im Body maskiert (***).
 *   3. Nicht-Admin kann die Endpunkte nicht ansprechen (Forbidden).
 *   4. Audit-Eintrag `chat.moderation.masked` wird geschrieben.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("Chat-Wortfilter", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  it("Admin-CRUD: anlegen, listen, löschen", async () => {
    // Erst-Admin-Hochstufung via ADMIN_EMAIL (siehe admin-bootstrap.test.ts).
    process.env["ADMIN_EMAIL"] = "mod-admin@jass.local";
    try {
      const { http: adminHttp } = await signUpAndIn(app, {
        email: "mod-admin@jass.local",
        password: "mod-admin-passw0rd-12!",
        name: "mod_admin",
      });

      // Anlegen.
      const add = await adminHttp.request("/api/admin/banned-words", {
        method: "POST",
        body: JSON.stringify({ word: "Scheiß", reason: "Beleidigung" }),
      });
      expect(add.status, JSON.stringify(add.body)).toBe(201);

      // Listen — sollte das normalisierte (lowercase) Wort enthalten.
      const list = await adminHttp.request<{
        entries: { word: string; reason: string | null }[];
      }>("/api/admin/banned-words", { method: "GET" });
      expect(list.status).toBe(200);
      expect(list.body.entries).toHaveLength(1);
      expect(list.body.entries[0]?.word).toBe("scheiß");
      expect(list.body.entries[0]?.reason).toBe("Beleidigung");

      // Doppelt anlegen → 409.
      const dup = await adminHttp.request("/api/admin/banned-words", {
        method: "POST",
        body: JSON.stringify({ word: "SCHEIß" }),
      });
      expect(dup.status).toBe(409);

      // Löschen.
      const del = await adminHttp.request("/api/admin/banned-words/scheiß", {
        method: "DELETE",
      });
      expect(del.status).toBeLessThan(300);

      const after = await adminHttp.request<{ entries: unknown[] }>("/api/admin/banned-words", {
        method: "GET",
      });
      expect(after.body.entries).toHaveLength(0);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("Lobby-Nachricht mit gebanntem Wort wird maskiert + Audit", async () => {
    process.env["ADMIN_EMAIL"] = "mod-admin-2@jass.local";
    try {
      // Admin pflegt die Liste.
      const { http: adminHttp, userId: adminId } = await signUpAndIn(app, {
        email: "mod-admin-2@jass.local",
        password: "mod-admin2-passw0rd-12!",
        name: "mod_admin_2",
      });
      const add = await adminHttp.request("/api/admin/banned-words", {
        method: "POST",
        body: JSON.stringify({ word: "fuck" }),
      });
      expect(add.status).toBe(201);

      // Ein normaler User schickt eine Lobby-Nachricht mit dem Wort.
      const { http: userHttp, userId } = await signUpAndIn(app, {
        email: "chatty@jass.local",
        password: "chatty-passw0rd-12!",
        name: "chatty",
      });
      const send = await userHttp.request<{ body: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          channelKey: "lobby:global",
          body: "Was ein fuck — das Spiel!",
        }),
      });
      expect(send.status, JSON.stringify(send.body)).toBe(201);
      // Der Body kommt sanitized-HTML zurück; das gefilterte "***" ist drin,
      // "fuck" nicht (egal in welcher Form).
      expect(send.body.body).toContain("***");
      expect(send.body.body.toLowerCase()).not.toContain("fuck");

      // Audit-Eintrag mit den gematchten Wörtern.
      const audit = await app.prisma.auditLog.findFirst({
        where: { action: "chat.moderation.masked", actorId: userId },
      });
      expect(audit).not.toBeNull();
      const meta = audit?.meta as { words?: string[] } | null;
      expect(meta?.words).toEqual(["fuck"]);
      expect(adminId).not.toBe(userId); // sanity
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("Regex-Eintrag: roh gespeichert (nicht lowercase) + maskiert Live-Nachricht", async () => {
    process.env["ADMIN_EMAIL"] = "mod-admin-rx@jass.local";
    try {
      const { http: adminHttp } = await signUpAndIn(app, {
        email: "mod-admin-rx@jass.local",
        password: "mod-admin-rx-passw0rd-12!",
        name: "mod_admin_rx",
      });
      const add = await adminHttp.request("/api/admin/banned-words", {
        method: "POST",
        body: JSON.stringify({ word: "\\d{4,}", isRegex: true, reason: "Telefonnummern" }),
      });
      expect(add.status, JSON.stringify(add.body)).toBe(201);

      const list = await adminHttp.request<{
        entries: { word: string; isRegex: boolean }[];
      }>("/api/admin/banned-words", { method: "GET" });
      expect(list.body.entries[0]?.word).toBe("\\d{4,}"); // NICHT zu lowercase verändert
      expect(list.body.entries[0]?.isRegex).toBe(true);

      const { http: userHttp } = await signUpAndIn(app, {
        email: "rx-chatty@jass.local",
        password: "rx-chatty-passw0rd-12!",
        name: "rx_chatty",
      });
      const send = await userHttp.request<{ body: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ channelKey: "lobby:global", body: "Ruf an: 123456" }),
      });
      expect(send.status, JSON.stringify(send.body)).toBe(201);
      expect(send.body.body).toContain("***");
      expect(send.body.body).not.toContain("123456");
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("Regex-Validierung: ungültiges + nicht unterstütztes Muster → 409", async () => {
    process.env["ADMIN_EMAIL"] = "mod-admin-bad@jass.local";
    try {
      const { http } = await signUpAndIn(app, {
        email: "mod-admin-bad@jass.local",
        password: "mod-admin-bad-passw0rd-12!",
        name: "mod_admin_bad",
      });
      const unclosed = await http.request("/api/admin/banned-words", {
        method: "POST",
        body: JSON.stringify({ word: "(unclosed", isRegex: true }),
      });
      expect(unclosed.status).toBe(409);

      // Rückbezug — von RE2 nicht unterstützt → muss abgelehnt werden.
      const backref = await http.request("/api/admin/banned-words", {
        method: "POST",
        body: JSON.stringify({ word: "(a)\\1", isRegex: true }),
      });
      expect(backref.status).toBe(409);
    } finally {
      delete process.env["ADMIN_EMAIL"];
    }
  });

  it("Nicht-Admin bekommt Forbidden auf /api/admin/banned-words", async () => {
    const { http } = await signUpAndIn(app, {
      email: "no-admin@jass.local",
      password: "no-admin-passw0rd-12!",
      name: "no_admin",
    });
    const list = await http.request("/api/admin/banned-words", { method: "GET" });
    expect(list.status).toBe(403);
    const add = await http.request("/api/admin/banned-words", {
      method: "POST",
      body: JSON.stringify({ word: "egal" }),
    });
    expect(add.status).toBe(403);
  });
});
