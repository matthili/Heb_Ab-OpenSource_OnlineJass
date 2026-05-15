/**
 * Unit-Tests für BlocklistService.
 *
 * Die reine Pattern-Match-Funktion ist exportiert und brauch kein Prisma —
 * darauf konzentrieren wir uns hier. Den DB-Zugriff testen wir in der
 * Integration-Test-Suite (M3-F, Testcontainers).
 */
import { describe, expect, it } from "vitest";

import { matchesPattern } from "../src/modules/blocklist/blocklist.service.js";

describe("Blocklist matchesPattern", () => {
  describe("Domain-Pattern (@…)", () => {
    it("matched die genaue Domain", () => {
      expect(matchesPattern("alice@spam.example", "@spam.example")).toBe(true);
      expect(matchesPattern("bob@spam.example", "@spam.example")).toBe(true);
    });

    it("matched nicht, wenn nur Substring vorkommt", () => {
      expect(matchesPattern("alice@notspam.example", "@spam.example")).toBe(false);
      expect(matchesPattern("alice@spam.example.org", "@spam.example")).toBe(false);
    });

    it("ist case-insensitive", () => {
      expect(matchesPattern("alice@SPAM.example", "@spam.example")).toBe(true);
      expect(matchesPattern("alice@spam.example", "@SPAM.example")).toBe(true);
    });
  });

  describe("Glob-Pattern (mit *)", () => {
    it("`*+spam@*` matched Plus-Spam-Adressen", () => {
      expect(matchesPattern("alice+spam@gmail.com", "*+spam@*")).toBe(true);
      expect(matchesPattern("bob+spam@anywhere.tld", "*+spam@*")).toBe(true);
    });

    it("`*+spam@*` matched nicht reguläre Adressen", () => {
      expect(matchesPattern("alice@gmail.com", "*+spam@*")).toBe(false);
      expect(matchesPattern("spam@gmail.com", "*+spam@*")).toBe(false);
    });

    it("`*@example.com` wirkt wie eine Domain-Regel", () => {
      expect(matchesPattern("anyone@example.com", "*@example.com")).toBe(true);
      expect(matchesPattern("anyone@example.org", "*@example.com")).toBe(false);
    });

    it("Glob-Sonderzeichen sind escaped (keine Regex-Injektion)", () => {
      // `.` darf nicht als Regex-Wildcard wirken.
      expect(matchesPattern("alicexgmail.com", "alice.gmail.com")).toBe(false);
      expect(matchesPattern("alice.gmail.com", "alice.gmail.com")).toBe(true);
    });
  });

  describe("Exact-Match (ohne * und ohne @-Start)", () => {
    it("matched nur die exakte Adresse", () => {
      expect(matchesPattern("evil@beispiel.at", "evil@beispiel.at")).toBe(true);
      expect(matchesPattern("nicht-evil@beispiel.at", "evil@beispiel.at")).toBe(false);
    });

    it("ist case-insensitive", () => {
      expect(matchesPattern("EVIL@beispiel.at", "evil@beispiel.at")).toBe(true);
    });
  });

  describe("Robustheit", () => {
    it("Whitespace im Pattern wird getrimmt", () => {
      expect(matchesPattern("alice@spam.example", "  @spam.example  ")).toBe(true);
    });

    it("Leeres Pattern matched nichts Sinnvolles", () => {
      // exact-match auf "" — eine real existierende Email matched darauf nicht
      expect(matchesPattern("alice@x.tld", "")).toBe(false);
    });
  });
});
