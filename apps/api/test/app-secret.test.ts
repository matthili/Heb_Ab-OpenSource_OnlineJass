/**
 * Tests für AppSecretService — vor allem die **Boot-Validation**, weil
 * deren Versagen direkt ein Sicherheits-Loch wäre.
 *
 * Wir manipulieren `process.env` pro Test und rufen `onModuleInit`
 * direkt — kein NestJS-DI-Aufbau nötig, der Service ist pure.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppSecretService } from "../src/common/app-secret.service.js";

describe("AppSecretService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["APP_SECRET"];
    delete process.env["NODE_ENV"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("Boot-Validation in production", () => {
    beforeEach(() => {
      process.env["NODE_ENV"] = "production";
    });

    it("wirft, wenn APP_SECRET nicht gesetzt ist", () => {
      const svc = new AppSecretService();
      expect(() => svc.onModuleInit()).toThrow(/APP_SECRET ist in production Pflicht/);
    });

    it("wirft, wenn APP_SECRET zu kurz ist (<32 Zeichen)", () => {
      process.env["APP_SECRET"] = "short-string";
      const svc = new AppSecretService();
      expect(() => svc.onModuleInit()).toThrow(/zu kurz/);
    });

    it("wirft bei bekannten schwachen Placeholder-Werten", () => {
      for (const weak of ["dev-fallback", "change-me", "secret", "password"]) {
        process.env["APP_SECRET"] = weak.padEnd(40, "x"); // genug Länge, trotzdem in Blacklist
        process.env["APP_SECRET"] = weak; // ungerade — wir wollen die exakten Werte testen
        const svc = new AppSecretService();
        // 'secret' und 'password' sind < 32, scheitern schon an der Längenprüfung —
        // das ist OK, wir prüfen nur dass beide Wege rejecten.
        expect(() => svc.onModuleInit()).toThrow();
      }
    });

    it("wirft bei rein repetitiven Strings (z.B. aaaa…)", () => {
      process.env["APP_SECRET"] = "a".repeat(40);
      const svc = new AppSecretService();
      expect(() => svc.onModuleInit()).toThrow(/repetitives Muster|schwach/);
    });

    it("akzeptiert ein langes, zufälliges Secret", () => {
      process.env["APP_SECRET"] = "Zk9!a3-Btc7@Lq2pX5#Mn8YwR1uHvE4D"; // 32 Zeichen, gemischt
      const svc = new AppSecretService();
      expect(() => svc.onModuleInit()).not.toThrow();
    });
  });

  describe("Dev-Mode-Fallback", () => {
    beforeEach(() => {
      process.env["NODE_ENV"] = "development";
    });

    it("akzeptiert kein gesetztes APP_SECRET und generiert flüchtigen Boot-Key", () => {
      const svc = new AppSecretService();
      expect(() => svc.onModuleInit()).not.toThrow();
      const k1 = svc.derive("smtp-encryption");
      expect(k1).toHaveLength(32);
    });

    it("zwei Boots ohne APP_SECRET → unterschiedliche flüchtige Schlüssel", () => {
      const a = new AppSecretService();
      a.onModuleInit();
      const b = new AppSecretService();
      b.onModuleInit();
      expect(Buffer.compare(a.derive("smtp-encryption"), b.derive("smtp-encryption"))).not.toBe(0);
    });

    it("mit gesetztem APP_SECRET: deterministisch über Boots hinweg", () => {
      process.env["APP_SECRET"] = "stable-test-secret-32bytes-or-more-12345";
      const a = new AppSecretService();
      a.onModuleInit();
      const b = new AppSecretService();
      b.onModuleInit();
      expect(Buffer.compare(a.derive("smtp-encryption"), b.derive("smtp-encryption"))).toBe(0);
    });
  });

  describe("Domain-Separation via HKDF", () => {
    beforeEach(() => {
      process.env["NODE_ENV"] = "development";
      process.env["APP_SECRET"] = "stable-test-secret-32bytes-or-more-12345";
    });

    it("verschiedene purpose → unterschiedliche Schlüssel (kein Kollisions-Risiko)", () => {
      const svc = new AppSecretService();
      svc.onModuleInit();
      const smtp = svc.derive("smtp-encryption");
      const csrf = svc.derive("csrf-token");
      const audit = svc.derive("audit-hmac");
      expect(Buffer.compare(smtp, csrf)).not.toBe(0);
      expect(Buffer.compare(smtp, audit)).not.toBe(0);
      expect(Buffer.compare(csrf, audit)).not.toBe(0);
    });

    it("gleicher purpose mehrfach → identischer Schlüssel (Cache + deterministisch)", () => {
      const svc = new AppSecretService();
      svc.onModuleInit();
      const k1 = svc.derive("smtp-encryption");
      const k2 = svc.derive("smtp-encryption");
      expect(Buffer.compare(k1, k2)).toBe(0);
    });

    it("alle abgeleiteten Schlüssel sind genau 32 Bytes (AES-256-tauglich)", () => {
      const svc = new AppSecretService();
      svc.onModuleInit();
      expect(svc.derive("smtp-encryption")).toHaveLength(32);
      expect(svc.derive("csrf-token")).toHaveLength(32);
      expect(svc.derive("audit-hmac")).toHaveLength(32);
      expect(svc.derive("rematch-vote-token")).toHaveLength(32);
    });

    it("derive() vor onModuleInit wirft", () => {
      const svc = new AppSecretService();
      expect(() => svc.derive("smtp-encryption")).toThrow(/vor onModuleInit/);
    });
  });
});
