/**
 * Tests für die reine Shape-Funktion `shapePublicProfile`:
 * gleiche User/Profile-Daten, verschiedene Viewer → unterschiedlich gefilterte
 * Output-Objekte. Kein DB-Mocking nötig.
 */
import { describe, expect, it } from "vitest";
import type { Profile, User } from "@prisma/client";

import { shapePublicProfile } from "../src/modules/users/users.service.js";
import type { ViewerContext } from "../src/modules/users/visibility.js";

const USER: User = {
  id: "user-1",
  email: "matthias@jass.local",
  emailVerified: true,
  name: "matthias_test",
  image: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  role: "PLAYER",
  status: "ACTIVE",
  locale: "de",
  deletedAt: null,
  lastSeenAt: null,
  adminNote: null,
};

const PROFILE: Profile = {
  userId: "user-1",
  realFirstName: "Matthias",
  realLastName: "Mustermann",
  birthDate: new Date("1980-03-15"),
  city: "Bregenz",
  country: "Österreich",
  hobbies: "Jassen, Wandern",
  bio: "Erfinder von Heb ab!",
  avatarUrl: "https://example.com/avatar.png",
  visibility: {
    // realFirstName ungesetzt → Default LOGGED_IN
    realLastName: "PRIVATE",
    birthDate: "FRIENDS",
    city: "PUBLIC",
    // country, hobbies, bio, avatarUrl ungesetzt → Defaults
  },
  publicLeaderboard: false,
  dmPolicy: "ALL",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("shapePublicProfile — Visibility-Filter", () => {
  it("anonymer Viewer: nur PUBLIC-Felder sichtbar", () => {
    const ctx: ViewerContext = { viewerId: null, isSelf: false, areFriends: false };
    const v = shapePublicProfile(USER, PROFILE, ctx);

    expect(v.name).toBe("matthias_test"); // immer öffentlich
    expect(v.city).toBe("Bregenz"); // PUBLIC
    expect(v.bio).toBe("Erfinder von Heb ab!"); // Default PUBLIC
    expect(v.avatarUrl).toBe("https://example.com/avatar.png");
    expect(v.realFirstName).toBeNull(); // LOGGED_IN-Default → blocked
    expect(v.realLastName).toBeNull(); // PRIVATE
    expect(v.birthDate).toBeNull(); // FRIENDS
    expect(v.country).toBeNull(); // LOGGED_IN-Default
    expect(v.hobbies).toBeNull(); // LOGGED_IN-Default
  });

  it("eingeloggter Fremder: PUBLIC + LOGGED_IN sichtbar", () => {
    const ctx: ViewerContext = { viewerId: "other", isSelf: false, areFriends: false };
    const v = shapePublicProfile(USER, PROFILE, ctx);

    expect(v.realFirstName).toBe("Matthias"); // LOGGED_IN-Default
    expect(v.city).toBe("Bregenz");
    expect(v.country).toBe("Österreich");
    expect(v.hobbies).toBe("Jassen, Wandern");
    expect(v.realLastName).toBeNull(); // PRIVATE
    expect(v.birthDate).toBeNull(); // FRIENDS, kein Freund
  });

  it("Freund: PUBLIC + LOGGED_IN + FRIENDS, aber nicht PRIVATE", () => {
    const ctx: ViewerContext = { viewerId: "friend", isSelf: false, areFriends: true };
    const v = shapePublicProfile(USER, PROFILE, ctx);

    expect(v.realFirstName).toBe("Matthias");
    expect(v.birthDate?.toISOString()).toBe("1980-03-15T00:00:00.000Z");
    expect(v.realLastName).toBeNull(); // PRIVATE bleibt versteckt
  });

  it("Self-View: alles sichtbar, auch PRIVATE", () => {
    const ctx: ViewerContext = { viewerId: "user-1", isSelf: true, areFriends: false };
    const v = shapePublicProfile(USER, PROFILE, ctx);

    expect(v.realFirstName).toBe("Matthias");
    expect(v.realLastName).toBe("Mustermann");
    expect(v.birthDate?.toISOString()).toBe("1980-03-15T00:00:00.000Z");
  });

  it("Profile-Record fehlt komplett → alle optionalen Felder null", () => {
    const ctx: ViewerContext = { viewerId: "user-1", isSelf: true, areFriends: false };
    const v = shapePublicProfile(USER, null, ctx);

    expect(v.name).toBe("matthias_test");
    expect(v.realFirstName).toBeNull();
    expect(v.bio).toBeNull();
    expect(v.avatarUrl).toBeNull();
  });
});
