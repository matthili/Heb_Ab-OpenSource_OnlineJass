/**
 * Unit-Test der Hinweis-Mail nach einem Passwortwechsel im Profil
 * (`buildPasswordChangedMail`): Zeitpunkt in österreichischer Zeit, Weg zum
 * Zurücksetzen über die Adresse der Spieloberfläche, kein Link, HTML-sicher.
 * Dazu `getWebPublicUrl`, aus dem `sendPasswordChangedMail` diese Adresse holt.
 */
import { afterEach, describe, expect, it } from "vitest";

import { getWebPublicUrl } from "../src/common/trusted-origins.js";
import { buildPasswordChangedMail } from "../src/modules/mail/mail.service.js";

const BASE = {
  displayName: "matti",
  // 17:45 UTC = 19:45 Wiener Sommerzeit
  changedAt: new Date("2026-10-04T17:45:00.000Z"),
  appUrl: "https://jass.example.test/app",
  noReply: true,
};

describe("buildPasswordChangedMail", () => {
  it("nennt Zeitpunkt, abgemeldete Geräte und den Weg zum Zurücksetzen", () => {
    const mail = buildPasswordChangedMail(BASE);
    expect(mail.subject).toBe("Heb ab! — Dein Passwort wurde geändert");
    expect(mail.text).toContain("Servus matti,");
    expect(mail.text).toContain("4. Oktober 2026 um 19:45 Uhr");
    expect(mail.text).toContain("Alle anderen Geräte wurden dabei abgemeldet.");
    expect(mail.text).toContain(
      'auf https://jass.example.test/app unter „Anmelden" → „Passwort vergessen?"'
    );
    expect(mail.text).toContain("No-Reply-Adresse");
    // Bewusst kein Link in der Mail — der Weg führt über die bekannte Adresse.
    expect(mail.html).not.toContain("<a ");
  });

  it("kommt ohne Adresse aus", () => {
    const mail = buildPasswordChangedMail({ ...BASE, appUrl: null });
    expect(mail.text).toContain('sofort zurück: unter „Anmelden" → „Passwort vergessen?"');
  });

  it("maskiert den Spielernamen im HTML", () => {
    const mail = buildPasswordChangedMail({ ...BASE, displayName: "<b>x</b>" });
    expect(mail.html).toContain("Servus &lt;b&gt;x&lt;/b&gt;,");
    expect(mail.html).not.toContain("<b>x</b>");
  });
});

describe("getWebPublicUrl", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("nimmt WEB_PUBLIC_URL, nicht die API-Adresse", () => {
    process.env["NODE_ENV"] = "production";
    process.env["BETTER_AUTH_URL"] = "https://jass.example.test";
    process.env["WEB_PUBLIC_URL"] = "https://jass.example.test/app";
    expect(getWebPublicUrl()).toBe("https://jass.example.test/app");
  });

  it("production ohne WEB_PUBLIC_URL: null statt Dev-Adresse", () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["WEB_PUBLIC_URL"];
    expect(getWebPublicUrl()).toBeNull();
  });

  it("development ohne WEB_PUBLIC_URL: Vite-Dev-Server", () => {
    process.env["NODE_ENV"] = "development";
    delete process.env["WEB_PUBLIC_URL"];
    expect(getWebPublicUrl()).toBe("http://localhost:5173");
  });
});
