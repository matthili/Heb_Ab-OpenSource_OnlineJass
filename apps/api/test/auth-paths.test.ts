/**
 * Vertrags-Test: Jeder Pfad in `AUTH_PATHS` muss in der installierten
 * Better-Auth-Version als Endpunkt existieren.
 *
 * Hintergrund: Better Auth hat `/forget-password` in `/request-password-reset`
 * umbenannt. Captcha-Pflicht und Rate-Limit hingen am alten Namen, den die
 * eingesetzte Version (1.6) gar nicht kennt, und griffen deshalb nie — und das
 * Reset-Formular lief ins Leere, ohne dass ein Test rot wurde. Dieser Test
 * schlägt bei der nächsten Umbenennung schon beim Better-Auth-Update an.
 */
import { betterAuth } from "better-auth";
import { describe, expect, it } from "vitest";

import { AUTH_PATHS } from "../src/modules/auth/auth-paths.js";

// Minimal-Instanz nur für die Endpunktliste — ohne DB, es läuft kein Request.
// `emailAndPassword` ist wie in Produktion aktiv (inkl. Reset-Mail-Callback).
const auth = betterAuth({
  secret: "test-secret-only-for-endpoint-listing-0123456789",
  baseURL: "http://localhost:3000",
  emailAndPassword: { enabled: true, sendResetPassword: async () => {} },
});

const endpointPaths = new Set(
  Object.values(auth.api)
    .map((endpoint) => (endpoint as { path?: unknown }).path)
    .filter((path): path is string => typeof path === "string")
);

describe("AUTH_PATHS ↔ Better-Auth-Endpunkte", () => {
  it("die Endpunktliste ist nicht leer (sonst prüft der Test nichts)", () => {
    expect(endpointPaths.size).toBeGreaterThan(10);
  });

  it.each(Object.entries(AUTH_PATHS))("%s (%s) ist ein Better-Auth-Endpunkt", (_name, path) => {
    expect(endpointPaths.has(path), `${path} fehlt in Better Auth`).toBe(true);
  });
});
