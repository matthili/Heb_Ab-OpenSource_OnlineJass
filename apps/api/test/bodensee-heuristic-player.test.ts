/**
 * Unit-Tests für den Bodensee-Heuristik-Player (TS-Port von
 * `players/bodensee_heuristic_player.py`). Deckt Ansage (inkl. Stufen-Filter)
 * und Kartenwahl (Anspielen / Übernehmen / Abwerfen) ab.
 */
import { describe, expect, it } from "vitest";

import { announceConstraints, type Card, type Variant } from "@jass/engine";

import { BodenseeHeuristicPlayer } from "../src/modules/game/players/bodensee-heuristic-player.js";

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

const ALLES = announceConstraints("ALLES");
const heur = new BodenseeHeuristicPlayer();

describe("BodenseeHeuristicPlayer — Ansage", () => {
  it("wählt TRUMPF auf Eichel bei trumpf-lastigem Pool (Buur + Nell + Asse)", () => {
    const pool: Card[] = [
      card("EICHEL", "UNTER"),
      card("EICHEL", "NEUN"),
      card("EICHEL", "ASS"),
      card("EICHEL", "KOENIG"),
      card("EICHEL", "OBER"),
      card("EICHEL", "ZEHN"),
      card("HERZ", "ASS"),
      card("HERZ", "ZEHN"),
      card("LAUB", "ASS"),
      card("LAUB", "ZEHN"),
      card("SCHELLE", "ASS"),
      card("SCHELLE", "KOENIG"),
    ];
    const ann = heur.chooseAnnouncement(pool, ALLES);
    expect(ann.variant.mode).toBe("TRUMPF");
    expect(ann.variant.trump_suit).toBe("EICHEL");
    expect(ann.slalom).toBe(false);
  });

  it("respektiert die Ansage-Stufe: bei TRUMPF-only kommt eine TRUMPF-Ansage, auch wenn UNTEN höher scort", () => {
    // Niedriger Pool, der ohne Filter klar UNTEN bevorzugen würde.
    const pool: Card[] = [
      card("EICHEL", "SECHS"),
      card("EICHEL", "SIEBEN"),
      card("EICHEL", "ACHT"),
      card("HERZ", "SECHS"),
      card("HERZ", "SIEBEN"),
      card("LAUB", "SECHS"),
      card("LAUB", "ACHT"),
      card("SCHELLE", "SECHS"),
      card("SCHELLE", "SIEBEN"),
      card("HERZ", "ACHT"),
      card("LAUB", "SIEBEN"),
      card("SCHELLE", "ACHT"),
    ];
    const ann = heur.chooseAnnouncement(pool, announceConstraints("TRUMPF"));
    expect(ann.variant.mode).toBe("TRUMPF");
    expect(ann.slalom).toBe(false);
  });
});

describe("BodenseeHeuristicPlayer — Kartenwahl", () => {
  it("Anspielen bei TRUMPF: zieht den Buur zuerst", () => {
    const variant: Variant = { mode: "TRUMPF", trump_suit: "EICHEL" };
    const legal: Card[] = [card("EICHEL", "UNTER"), card("SCHELLE", "ASS"), card("LAUB", "SECHS")];
    expect(heur.chooseCard(legal, [], variant)).toEqual(card("EICHEL", "UNTER"));
  });

  it("Anspielen bei OBEN: spielt das Ass zuerst", () => {
    const variant: Variant = { mode: "OBEN" };
    const legal: Card[] = [card("HERZ", "ASS"), card("LAUB", "SECHS"), card("SCHELLE", "OBER")];
    expect(heur.chooseCard(legal, [], variant)).toEqual(card("HERZ", "ASS"));
  });

  it("Übernehmen: nimmt die NIEDRIGSTE reichende Karte (spart die höhere)", () => {
    const variant: Variant = { mode: "OBEN" };
    const trick: Card[] = [card("SCHELLE", "OBER")]; // Gegner legt Ober vor
    const legal: Card[] = [card("SCHELLE", "ASS"), card("SCHELLE", "KOENIG")]; // beide schlagen Ober
    // König reicht und ist die niedrigere → kommt; das Ass bleibt für später.
    expect(heur.chooseCard(legal, trick, variant)).toEqual(card("SCHELLE", "KOENIG"));
  });

  it("Nicht übernehmbar: wirft die niedrigste Karte mit niedrigstem Wert ab", () => {
    const variant: Variant = { mode: "OBEN" };
    const trick: Card[] = [card("SCHELLE", "ASS")]; // unschlagbar in OBEN
    const legal: Card[] = [card("SCHELLE", "SECHS"), card("SCHELLE", "SIEBEN")];
    expect(heur.chooseCard(legal, trick, variant)).toEqual(card("SCHELLE", "SECHS"));
  });
});
