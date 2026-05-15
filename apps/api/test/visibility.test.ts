import { describe, expect, it } from "vitest";

import {
  DEFAULT_VISIBILITY,
  canSeeField,
  resolveVisibility,
  type ViewerContext,
} from "../src/modules/users/visibility.js";

const SELF: ViewerContext = { viewerId: "user-1", isSelf: true, areFriends: false };
const LOGGED_IN: ViewerContext = {
  viewerId: "user-99",
  isSelf: false,
  areFriends: false,
};
const FRIEND: ViewerContext = { viewerId: "user-99", isSelf: false, areFriends: true };
const ANON: ViewerContext = { viewerId: null, isSelf: false, areFriends: false };

describe("canSeeField — Sichtbarkeits-Stufen", () => {
  describe("PUBLIC", () => {
    it("sehen alle: anonym, eingeloggt, Freund, self", () => {
      expect(canSeeField("PUBLIC", ANON)).toBe(true);
      expect(canSeeField("PUBLIC", LOGGED_IN)).toBe(true);
      expect(canSeeField("PUBLIC", FRIEND)).toBe(true);
      expect(canSeeField("PUBLIC", SELF)).toBe(true);
    });
  });

  describe("LOGGED_IN", () => {
    it("anonym sieht nicht, eingeloggt sieht", () => {
      expect(canSeeField("LOGGED_IN", ANON)).toBe(false);
      expect(canSeeField("LOGGED_IN", LOGGED_IN)).toBe(true);
      expect(canSeeField("LOGGED_IN", FRIEND)).toBe(true);
      expect(canSeeField("LOGGED_IN", SELF)).toBe(true);
    });
  });

  describe("FRIENDS", () => {
    it("nur Freunde + self", () => {
      expect(canSeeField("FRIENDS", ANON)).toBe(false);
      expect(canSeeField("FRIENDS", LOGGED_IN)).toBe(false);
      expect(canSeeField("FRIENDS", FRIEND)).toBe(true);
      expect(canSeeField("FRIENDS", SELF)).toBe(true);
    });
  });

  describe("PRIVATE", () => {
    it("nur self", () => {
      expect(canSeeField("PRIVATE", ANON)).toBe(false);
      expect(canSeeField("PRIVATE", LOGGED_IN)).toBe(false);
      expect(canSeeField("PRIVATE", FRIEND)).toBe(false);
      expect(canSeeField("PRIVATE", SELF)).toBe(true);
    });
  });

  it("Self-Override gilt unabhängig vom Level", () => {
    for (const level of ["PUBLIC", "LOGGED_IN", "FRIENDS", "PRIVATE"] as const) {
      expect(canSeeField(level, SELF)).toBe(true);
    }
  });
});

describe("resolveVisibility — User-Wert vs. Default", () => {
  it("nimmt User-Wert, wenn gesetzt", () => {
    expect(resolveVisibility("city", { city: "PRIVATE" })).toBe("PRIVATE");
    expect(resolveVisibility("bio", { bio: "FRIENDS" })).toBe("FRIENDS");
  });

  it("fällt auf Default zurück, wenn Feld nicht in Map", () => {
    expect(resolveVisibility("city", {})).toBe(DEFAULT_VISIBILITY.city);
    expect(resolveVisibility("bio", null)).toBe(DEFAULT_VISIBILITY.bio);
    expect(resolveVisibility("realFirstName", undefined)).toBe(DEFAULT_VISIBILITY.realFirstName);
  });

  it("Defaults laut Plan: real-Namen LOGGED_IN, bio/avatar PUBLIC", () => {
    expect(DEFAULT_VISIBILITY.realFirstName).toBe("LOGGED_IN");
    expect(DEFAULT_VISIBILITY.realLastName).toBe("LOGGED_IN");
    expect(DEFAULT_VISIBILITY.bio).toBe("PUBLIC");
    expect(DEFAULT_VISIBILITY.avatarUrl).toBe("PUBLIC");
  });
});
