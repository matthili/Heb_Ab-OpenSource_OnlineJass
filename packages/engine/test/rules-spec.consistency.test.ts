/**
 * Konsistenz-Test: vergleicht die hand-codierten Konstanten aus `types.ts`
 * mit der versionierten Quelle `external/jass-nn/jass_rules.json`.
 *
 * Verhindert stille Drift: ändert sich z.B. ein Punktwert oder die Trumpf-
 * Rangordnung in der Spec, schlägt dieser Test fehl, bevor irgendein
 * abhängiges Modell-Verhalten still bricht.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ENCODING_VERSION,
  MATCH_BONUS,
  NUM_PLAYERS,
  POINT_VALUES_NORMAL,
  POINT_VALUES_OBEN_UNTEN,
  POINT_VALUES_TRUMP,
  type Rank,
  RANKS,
  SPEC_VERSION,
  type Suit,
  SUITS,
  TOTAL_POINTS_PER_ROUND,
  TRICKS_PER_ROUND,
  TRUMP_RANK_ORDER,
  WELI_INDEX,
} from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(__dirname, "..", "..", "..", "external", "jass-nn", "jass_rules.json");

// --- Spec-Schema (nur die Felder, die wir hier vergleichen) -----------------

interface SpecDeck {
  total_cards: number;
  suits: { id: number; name: string }[];
  ranks: { id: number; name: string }[];
  card_index_formula: string;
}
interface SpecVariantTrumpf {
  card_points: {
    non_trump: Record<string, number>;
    trump: Record<string, number>;
  };
}
interface SpecVariantObenOrUnten {
  card_points: Record<string, number>;
}
interface SpecScoring {
  match_bonus: number;
  total_points_per_round: number;
}
interface SpecRoundFlow {
  num_players: number;
  tricks_per_round: number;
}
interface SpecSpecialCards {
  weli: { card_index: number };
}
interface JassRulesSpec {
  spec_version: string;
  deck: SpecDeck;
  variants: {
    trumpf: SpecVariantTrumpf;
    gumpf: SpecVariantTrumpf; // gleiche Struktur wie TRUMPF (trump+non_trump)
    oben: SpecVariantObenOrUnten;
    unten: SpecVariantObenOrUnten;
  };
  scoring: SpecScoring;
  round_flow: SpecRoundFlow;
  special_cards: SpecSpecialCards;
}

function loadSpec(): JassRulesSpec {
  try {
    return JSON.parse(readFileSync(SPEC_PATH, "utf8")) as JassRulesSpec;
  } catch (err) {
    throw new Error(
      `jass_rules.json nicht gefunden: ${SPEC_PATH}. Lauf \`pnpm sync:nn\`. ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

// --- Tests -------------------------------------------------------------------

describe("Spec-Konsistenz: types.ts gegen jass_rules.json", () => {
  const spec = loadSpec();

  it("SPEC_VERSION matched (1.2.0 mit Gumpf-Variante + score_composition)", () => {
    expect(SPEC_VERSION).toBe(spec.spec_version);
    expect(SPEC_VERSION).toBe("1.2.0");
  });

  it("ENCODING_VERSION ist auf 3.0.0 fixiert (passt zur Fixture-Datei)", () => {
    // jass_rules.json enthält encoding_version nicht selbst — die liegt in
    // encoding_fixtures.json + MANIFEST.json. Hier nur Selbst-Konsistenz.
    expect(ENCODING_VERSION).toBe("3.0.0");
  });

  it("Gumpf-Variante ist in der Spec vorhanden", () => {
    expect(spec.variants.gumpf).toBeDefined();
    expect(spec.variants.gumpf.card_points.trump.UNTER).toBe(20); // Buur
    expect(spec.variants.gumpf.card_points.trump.NEUN).toBe(14); // Nell
    expect(spec.variants.gumpf.card_points.non_trump.ACHT).toBe(0); // KEIN Geiss-8er-Bonus
  });

  it("GUMPF: trump-Punktwerte = POINT_VALUES_TRUMP (identisch zu TRUMPF)", () => {
    for (const r of RANKS) {
      expect(spec.variants.gumpf.card_points.trump[r]).toBe(POINT_VALUES_TRUMP[r]);
    }
  });

  it("GUMPF: non-trump-Punktwerte = POINT_VALUES_NORMAL (identisch zu TRUMPF non-trump)", () => {
    for (const r of RANKS) {
      expect(spec.variants.gumpf.card_points.non_trump[r]).toBe(POINT_VALUES_NORMAL[r]);
    }
  });

  it("Deck-Größe = 36", () => {
    expect(spec.deck.total_cards).toBe(36);
  });

  it("Suit-Namen + IDs stimmen mit SUITS", () => {
    const specSuits = spec.deck.suits.map((s) => s.name);
    expect(specSuits).toEqual([...SUITS]);
    spec.deck.suits.forEach((s, i) => expect(s.id).toBe(i));
  });

  it("Rank-Namen + IDs stimmen mit RANKS (Reihenfolge!)", () => {
    const specRanks = spec.deck.ranks.map((r) => r.name);
    expect(specRanks).toEqual([...RANKS]);
    spec.deck.ranks.forEach((r, i) => expect(r.id).toBe(i));
  });

  it("Karten-Index-Formel = suit_id * 9 + rank_id", () => {
    expect(spec.deck.card_index_formula).toBe("suit_id * 9 + rank_id");
  });

  it("Weli-Index = 9 (SCHELLE-SECHS)", () => {
    expect(spec.special_cards.weli.card_index).toBe(WELI_INDEX);
  });

  it("4 Spieler, 9 Stiche pro Runde", () => {
    expect(spec.round_flow.num_players).toBe(NUM_PLAYERS);
    expect(spec.round_flow.tricks_per_round).toBe(TRICKS_PER_ROUND);
  });

  it("Scoring-Konstanten match", () => {
    expect(spec.scoring.match_bonus).toBe(MATCH_BONUS);
    expect(spec.scoring.total_points_per_round).toBe(TOTAL_POINTS_PER_ROUND);
  });

  it("TRUMPF: non-trump-Punktwerte = POINT_VALUES_NORMAL", () => {
    for (const r of RANKS) {
      expect(spec.variants.trumpf.card_points.non_trump[r]).toBe(POINT_VALUES_NORMAL[r]);
    }
  });

  it("TRUMPF: trump-Punktwerte = POINT_VALUES_TRUMP (Buur=20, Nell=14)", () => {
    for (const r of RANKS) {
      expect(spec.variants.trumpf.card_points.trump[r]).toBe(POINT_VALUES_TRUMP[r]);
    }
  });

  it("OBEN: Punktwerte = POINT_VALUES_OBEN_UNTEN (8er=8)", () => {
    for (const r of RANKS) {
      expect(spec.variants.oben.card_points[r]).toBe(POINT_VALUES_OBEN_UNTEN[r]);
    }
  });

  it("UNTEN: Punktwerte = POINT_VALUES_OBEN_UNTEN (gleiche Tabelle wie OBEN)", () => {
    for (const r of RANKS) {
      expect(spec.variants.unten.card_points[r]).toBe(POINT_VALUES_OBEN_UNTEN[r]);
    }
  });

  it("TRUMP_RANK_ORDER: 152 Stichpunkte konsistent (Trumpf-Reihen-Sanity)", () => {
    // Höchster Trumpf = Buur (20), niedrigster = Sechs (0). Reihenfolge:
    // U > 9 > A > K > O > 10 > 8 > 7 > 6
    const orderedRanks: Rank[] = [
      "UNTER",
      "NEUN",
      "ASS",
      "KOENIG",
      "OBER",
      "ZEHN",
      "ACHT",
      "SIEBEN",
      "SECHS",
    ];
    const values = orderedRanks.map((r) => TRUMP_RANK_ORDER[r]);
    expect(values).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it("SUITS und RANKS sind unique und vollständig", () => {
    expect(new Set<Suit>(SUITS).size).toBe(4);
    expect(new Set<Rank>(RANKS).size).toBe(9);
  });
});
