/**
 * Tests für `checkPasswordStrength`. Verifiziert: schwache Passwörter
 * werden abgelehnt, starke akzeptiert, Kontext-Inputs (E-Mail, Name)
 * werden in zxcvbn-Heuristik einbezogen.
 */
import { describe, expect, it } from "vitest";

import {
  checkPasswordStrength,
  MIN_PASSWORD_STRENGTH_SCORE,
} from "../src/modules/auth/password-strength.js";

describe("checkPasswordStrength", () => {
  it("Mindest-Score-Konstante ist 3 (zxcvbn-Empfehlung 'safely unguessable')", () => {
    expect(MIN_PASSWORD_STRENGTH_SCORE).toBe(3);
  });

  it("lehnt klassische schwache Passwörter ab", async () => {
    for (const weak of ["password123", "qwerty123456", "letmein2024", "passw0rd"]) {
      const r = await checkPasswordStrength(weak);
      expect(r.ok, `'${weak}' sollte abgelehnt werden`).toBe(false);
      expect(r.score).toBeLessThan(MIN_PASSWORD_STRENGTH_SCORE);
    }
  });

  it("lehnt Passwörter ab, die den eigenen Namen / die E-Mail enthalten", async () => {
    const r = await checkPasswordStrength("matthias2026!", [
      "matthias@jass.local",
      "matthias",
      "matthias",
    ]);
    expect(r.ok).toBe(false);
  });

  it("akzeptiert ein langes, zufälliges Passwort", async () => {
    // 4 zufällige Wörter + Trennzeichen = solide Passphrase
    const strong = "Trumpf-Buur-Schelle-Sechs-Weli!";
    const r = await checkPasswordStrength(strong);
    expect(r.ok).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(MIN_PASSWORD_STRENGTH_SCORE);
  });

  it("liefert ein Feedback-Objekt mit suggestions", async () => {
    const r = await checkPasswordStrength("aaaaaa");
    expect(r.ok).toBe(false);
    expect(r.feedback).toHaveProperty("warning");
    expect(r.feedback).toHaveProperty("suggestions");
    expect(Array.isArray(r.feedback.suggestions)).toBe(true);
  });
});
