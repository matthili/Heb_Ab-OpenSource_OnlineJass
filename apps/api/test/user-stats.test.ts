/**
 * Unit-Tests für `extractUserResult` (Variant-spezifische Win-/Punkte-Extraktion
 * aus `Game.finalScore`).
 *
 * Reine Funktion ohne DB — deckt KREUZ_4P, SOLO_4P, BODENSEE_2P + defensive
 * Fälle (kaputter Blob, fremde Variante).
 */
import { describe, expect, it } from "vitest";

import { extractUserResult } from "../src/modules/users/user-stats.service.js";

describe("extractUserResult", () => {
  describe("KREUZ_4P (Team = seat % 2)", () => {
    it("Team 0 gewinnt mit 100 vs 57 — Sitz 0 hat 100 Pkt, won=true", () => {
      const r = extractUserResult("KREUZ_4P", 0, { team_card_points: [100, 57] });
      expect(r).toEqual({ points: 100, won: true });
    });

    it("Sitz 2 (auch Team 0) sieht denselben Team-Score + win", () => {
      const r = extractUserResult("KREUZ_4P", 2, { team_card_points: [100, 57] });
      expect(r).toEqual({ points: 100, won: true });
    });

    it("Sitz 1 (Team 1) verliert", () => {
      const r = extractUserResult("KREUZ_4P", 1, { team_card_points: [100, 57] });
      expect(r).toEqual({ points: 57, won: false });
    });

    it("Gleichstand zählt nicht als Sieg (strikt >)", () => {
      const r = extractUserResult("KREUZ_4P", 0, { team_card_points: [78, 78] });
      expect(r).toEqual({ points: 78, won: false });
    });
  });

  describe("SOLO_4P (jeder Sitz ist sein eigenes Team)", () => {
    it("Höchster Score gewinnt", () => {
      const r = extractUserResult("SOLO_4P", 2, { team_card_points: [40, 50, 90, 60] });
      expect(r).toEqual({ points: 90, won: true });
    });
    it("Niedriger Score → verliert", () => {
      const r = extractUserResult("SOLO_4P", 0, { team_card_points: [40, 50, 90, 60] });
      expect(r).toEqual({ points: 40, won: false });
    });
    it("Gleichstand am Maximum → won=true (≥ max)", () => {
      const r = extractUserResult("SOLO_4P", 1, { team_card_points: [40, 90, 90, 60] });
      expect(r).toEqual({ points: 90, won: true });
    });
  });

  describe("BODENSEE_2P (2 Einzelspieler)", () => {
    it("Sitz 0 mit 80 Pkt schlägt Sitz 1 mit 77 Pkt", () => {
      const r = extractUserResult("BODENSEE_2P", 0, { team_card_points: [80, 77] });
      expect(r).toEqual({ points: 80, won: true });
    });
    it("Sitz 1 mit 77 verliert", () => {
      const r = extractUserResult("BODENSEE_2P", 1, { team_card_points: [80, 77] });
      expect(r).toEqual({ points: 77, won: false });
    });
  });

  describe("defensive Fälle", () => {
    it("null/leerer Blob → points=null, won=null", () => {
      expect(extractUserResult("KREUZ_4P", 0, null)).toEqual({ points: null, won: null });
      expect(extractUserResult("KREUZ_4P", 0, {})).toEqual({ points: null, won: null });
    });

    it("falsches Array-Format → null", () => {
      expect(extractUserResult("BODENSEE_2P", 0, { team_card_points: "not-an-array" })).toEqual({
        points: null,
        won: null,
      });
    });

    it("unbekannte Variante → null", () => {
      expect(extractUserResult("KREUZ_STEIGERN", 0, { team_card_points: [10, 20] })).toEqual({
        points: null,
        won: null,
      });
    });

    it("Sitz außerhalb des Arrays → null", () => {
      expect(extractUserResult("SOLO_4P", 5, { team_card_points: [10, 20, 30, 40] })).toEqual({
        points: null,
        won: null,
      });
    });
  });
});
