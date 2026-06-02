/**
 * Unit-Test für `matchStartAnnouncerSiegerGibt` — Ansager der ersten Hand
 * einer neuen Partie bei `restartMode = SIEGER_GIBT` (Geber-Rotation:
 * „Sieger gibt, Verlierer fängt an").
 *
 * Reiner Logik-Test, kein Docker nötig.
 */
import { describe, expect, it } from "vitest";

import { matchStartAnnouncerSiegerGibt } from "../src/modules/lobby/match-start.js";

describe("matchStartAnnouncerSiegerGibt", () => {
  it("Kreuz: Team 0 gewinnt → Geber aus Team 0, Ansager ist ein Verlierer (Team 1)", () => {
    // lastStarter=0 → lastDealer=3; nächster Team-0-Sitz nach 3 ist 0 → Geber 0 → Ansager 1.
    const a = matchStartAnnouncerSiegerGibt("KREUZ_4P", [2500, 2000, 0, 0], 0);
    expect(a).toBe(1);
    expect(a % 2).toBe(1); // Team 1 = Verlierer fängt an
  });

  it("Kreuz: Team 1 gewinnt → Ansager ist ein Verlierer (Team 0)", () => {
    const a = matchStartAnnouncerSiegerGibt("KREUZ_4P", [2000, 2600, 0, 0], 2);
    expect(a).toBe(0);
    expect(a % 2).toBe(0);
  });

  it("Kreuz: Ansager gehört nie zum Sieger-Team — egal welcher letzte Geber", () => {
    for (let lastStarter = 0; lastStarter < 4; lastStarter++) {
      // Team 0 gewinnt deutlich → Ansager muss immer Team 1 sein.
      const a = matchStartAnnouncerSiegerGibt("KREUZ_4P", [3000, 1000, 0, 0], lastStarter);
      expect(a % 2).toBe(1);
    }
  });

  it("Solo: Sieger gibt, der nächste Spieler im Uhrzeigersinn fängt an", () => {
    // winner = Sitz 1; lastStarter=0 → lastDealer=3; nächster Sitz==1 → Geber 1 → Ansager 2.
    const a = matchStartAnnouncerSiegerGibt("SOLO_4P", [1000, 2500, 800, 1200], 0);
    expect(a).toBe(2);
  });

  it("Bodensee: Sieger (Sitz 0) gibt → Gegner (Sitz 1) sagt an", () => {
    const a = matchStartAnnouncerSiegerGibt("BODENSEE_2P", [2500, 2000, 0, 0], 1);
    expect(a).toBe(1);
  });

  it("Bodensee: Sieger (Sitz 1) gibt → Gegner (Sitz 0) sagt an", () => {
    const a = matchStartAnnouncerSiegerGibt("BODENSEE_2P", [2000, 2500, 0, 0], 0);
    expect(a).toBe(0);
  });
});
