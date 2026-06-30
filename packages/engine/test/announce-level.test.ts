import { describe, expect, it } from "vitest";

import {
  ANNOUNCE_LEVELS,
  announceConstraints,
  isAnnouncementAllowed,
  type Announcement,
} from "../src/types.js";

const trumpf: Announcement = { variant: { mode: "TRUMPF", trump_suit: "EICHEL" }, slalom: false };
const gumpf: Announcement = { variant: { mode: "GUMPF", trump_suit: "EICHEL" }, slalom: false };
const oben: Announcement = { variant: { mode: "OBEN" }, slalom: false };
const unten: Announcement = { variant: { mode: "UNTEN" }, slalom: false };
const slalom: Announcement = { variant: { mode: "OBEN" }, slalom: true };

describe("announceConstraints — Stufen → erlaubte Modi", () => {
  it("TRUMPF: nur Trumpf, kein Slalom", () => {
    const c = announceConstraints("TRUMPF");
    expect([...c.allowedModes].sort()).toEqual(["TRUMPF"]);
    expect(c.allowSlalom).toBe(false);
  });

  it("GEISS_BOCK: + Oben/Unten, noch kein Slalom, kein Gumpf", () => {
    const c = announceConstraints("GEISS_BOCK");
    expect([...c.allowedModes].sort()).toEqual(["OBEN", "TRUMPF", "UNTEN"]);
    expect(c.allowSlalom).toBe(false);
  });

  it("SLALOM: Oben/Unten + Slalom, weiterhin kein Gumpf", () => {
    const c = announceConstraints("SLALOM");
    expect([...c.allowedModes].sort()).toEqual(["OBEN", "TRUMPF", "UNTEN"]);
    expect(c.allowSlalom).toBe(true);
  });

  it("ALLES: alle vier Modi + Slalom", () => {
    const c = announceConstraints("ALLES");
    expect([...c.allowedModes].sort()).toEqual(["GUMPF", "OBEN", "TRUMPF", "UNTEN"]);
    expect(c.allowSlalom).toBe(true);
  });

  it("ANNOUNCE_LEVELS ist die aufsteigende Leiter", () => {
    expect(ANNOUNCE_LEVELS).toEqual(["TRUMPF", "GEISS_BOCK", "SLALOM", "ALLES"]);
  });
});

describe("isAnnouncementAllowed", () => {
  it("TRUMPF-Stufe lässt nur Trumpf zu", () => {
    expect(isAnnouncementAllowed(trumpf, "TRUMPF")).toBe(true);
    expect(isAnnouncementAllowed(oben, "TRUMPF")).toBe(false);
    expect(isAnnouncementAllowed(unten, "TRUMPF")).toBe(false);
    expect(isAnnouncementAllowed(slalom, "TRUMPF")).toBe(false);
    expect(isAnnouncementAllowed(gumpf, "TRUMPF")).toBe(false);
  });

  it("GEISS_BOCK lässt Oben/Unten zu, aber nicht Slalom/Gumpf", () => {
    expect(isAnnouncementAllowed(oben, "GEISS_BOCK")).toBe(true);
    expect(isAnnouncementAllowed(unten, "GEISS_BOCK")).toBe(true);
    expect(isAnnouncementAllowed(slalom, "GEISS_BOCK")).toBe(false);
    expect(isAnnouncementAllowed(gumpf, "GEISS_BOCK")).toBe(false);
  });

  it("SLALOM erlaubt Slalom, aber noch nicht Gumpf", () => {
    expect(isAnnouncementAllowed(slalom, "SLALOM")).toBe(true);
    expect(isAnnouncementAllowed(oben, "SLALOM")).toBe(true);
    expect(isAnnouncementAllowed(gumpf, "SLALOM")).toBe(false);
  });

  it("ALLES erlaubt alles inkl. Gumpf", () => {
    for (const ann of [trumpf, gumpf, oben, unten, slalom]) {
      expect(isAnnouncementAllowed(ann, "ALLES")).toBe(true);
    }
  });
});

describe("announceConstraints — unabhängiger Gumpf-Schalter (Veronika C1)", () => {
  it("GEISS_BOCK + allowGumpf: Gumpf erlaubt, Slalom NICHT (entkoppelt)", () => {
    const c = announceConstraints("GEISS_BOCK", true);
    expect([...c.allowedModes].sort()).toEqual(["GUMPF", "OBEN", "TRUMPF", "UNTEN"]);
    expect(c.allowSlalom).toBe(false);
  });

  it("SLALOM + allowGumpf: Gumpf UND Slalom erlaubt", () => {
    const c = announceConstraints("SLALOM", true);
    expect([...c.allowedModes].sort()).toEqual(["GUMPF", "OBEN", "TRUMPF", "UNTEN"]);
    expect(c.allowSlalom).toBe(true);
  });

  it("TRUMPF + allowGumpf: nur Trumpf + Gumpf, kein Oben/Unten/Slalom", () => {
    const c = announceConstraints("TRUMPF", true);
    expect([...c.allowedModes].sort()).toEqual(["GUMPF", "TRUMPF"]);
    expect(c.allowSlalom).toBe(false);
  });

  it("isAnnouncementAllowed: Gumpf folgt dem Schalter, nicht der Stufe", () => {
    expect(isAnnouncementAllowed(gumpf, "GEISS_BOCK", true)).toBe(true);
    expect(isAnnouncementAllowed(gumpf, "GEISS_BOCK", false)).toBe(false);
    // Slalom bleibt an die Stufe gebunden — vom Gumpf-Schalter unberührt.
    expect(isAnnouncementAllowed(slalom, "GEISS_BOCK", true)).toBe(false);
    expect(isAnnouncementAllowed(slalom, "SLALOM", false)).toBe(true);
  });
});
