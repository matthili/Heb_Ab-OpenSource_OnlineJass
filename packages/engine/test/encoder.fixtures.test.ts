/**
 * Fixture-Tests: führt alle Einträge in `external/jass-nn/encoding_fixtures.json`
 * gegen unseren Encoder und unsere Legal-Mask aus und vergleicht mit den von
 * Python erzeugten Erwartungswerten.
 *
 * Schlägt einer dieser Tests fehl, ist der TS-Port von der Spec gedriftet.
 * Vor einer Code-Änderung am Encoder: Spec und Fixtures aus dem NN-Repo neu
 * syncen (`pnpm sync:nn && pnpm verify:nn`).
 *
 * **Encoding-Version 3.0.0** (Spec 1.1.0, Release v0.5.0): 421-dim Vektor.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { encodeState, legalActionMask } from "../src/encoder.js";
import type { Announcement, Card, CompletedTrick, GameState, Variant } from "../src/types.js";
import { STATE_DIM } from "../src/types.js";

// --- Fixture-Schema (1:1 zu encoding_fixtures.json v3.0.0) ------------------

interface FixtureInput {
  hand: Card[];
  variant_effective: Variant;
  announcement: Announcement;
  current_trick_cards: Card[];
  current_trick_starter: number;
  player_idx: number;
  teams: number[];
  completed_tricks: CompletedTrick[];
  own_team_score: number;
  opp_team_score: number;
  round_idx: number;
  trick_idx: number;
  num_players: number;
}

interface FixtureExpected {
  state_vector: number[];
  legal_mask: number[];
  state_vector_shape?: number[];
  legal_mask_shape?: number[];
}

interface Fixture {
  id: string;
  description: string;
  input: FixtureInput;
  expected: FixtureExpected;
}

interface FixturesFile {
  spec_version: string;
  encoding_version: string;
  fixture_count: number;
  fixtures: Fixture[];
}

// --- Fixture-Datei einlesen --------------------------------------------------

const FIXTURES_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "external",
  "jass-nn",
  "encoding_fixtures.json"
);

function loadFixtures(): FixturesFile {
  try {
    const raw = readFileSync(FIXTURES_PATH, "utf8");
    return JSON.parse(raw) as FixturesFile;
  } catch (err) {
    throw new Error(
      `Fixture-Datei nicht gefunden oder nicht lesbar: ${FIXTURES_PATH}\n` +
        `Lauf zuerst \`pnpm sync:nn\` im Repo-Root.\n` +
        `Ursprünglicher Fehler: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function buildGameState(fx: FixtureInput): GameState {
  return {
    player_idx: fx.player_idx,
    variant: fx.variant_effective,
    announcement: fx.announcement,
    current_trick_cards: fx.current_trick_cards,
    current_trick_starter: fx.current_trick_starter,
    teams: fx.teams,
    completed_tricks: fx.completed_tricks,
    own_team_score: fx.own_team_score,
    opp_team_score: fx.opp_team_score,
    round_idx: fx.round_idx,
    trick_idx: fx.trick_idx,
    num_players: fx.num_players,
  };
}

// --- Tests -------------------------------------------------------------------

describe("Encoder fixtures (state_encoding.md v3.0.0)", () => {
  const file = loadFixtures();

  it("spec_version stimmt mit SPEC_VERSION in types.ts überein", () => {
    expect(file.spec_version).toBe("1.1.0");
  });

  it("encoding_version stimmt mit ENCODING_VERSION in types.ts überein", () => {
    expect(file.encoding_version).toBe("3.0.0");
  });

  it("Anzahl Fixtures stimmt mit fixture_count überein", () => {
    expect(file.fixtures).toHaveLength(file.fixture_count);
  });

  // Tabellen-getrieben: jede Fixture als eigener Test-Run.
  it.each(file.fixtures.map((f) => [f.id, f] as const))(
    "Fixture %s: state_vector + legal_mask byte-equivalent",
    (_id, fx) => {
      const state = buildGameState(fx.input);
      const vec = encodeState(fx.input.hand, state);
      const mask = legalActionMask(fx.input.hand, state);

      // Shape-Checks zuerst — hilfreichere Fehlermeldung bei Drift.
      expect(vec).toHaveLength(STATE_DIM);
      expect(mask).toHaveLength(36);

      // Mask ist uint8 (0/1) — exakte Gleichheit.
      expect(Array.from(mask)).toEqual(fx.expected.legal_mask);

      // State-Vector: elementweise mit Float32-Toleranz vergleichen.
      // Python-Fixtures runden Floats beim JSON-Dump auf 6 Nachkommastellen;
      // unsere Float32Array enthält die exakte Float32-Cast-Darstellung.
      // atol 1e-5 ist großzügig genug für Rundungs-Diff, aber eng genug für
      // echte Logik-Drift.
      const actual = Array.from(vec);
      const expected = fx.expected.state_vector;
      expect(actual).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i++) {
        const a = actual[i] as number;
        const e = expected[i] as number;
        if (Math.abs(a - e) > 1e-5) {
          throw new Error(
            `Vektor-Diff an Index ${i}: erwartet ${e}, erhalten ${a} (Δ=${Math.abs(a - e)})`
          );
        }
      }
    }
  );
});
