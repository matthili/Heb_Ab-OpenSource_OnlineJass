/**
 * Fixture-Tests für den Bodensee-Encoder (`bodensee_1.0.0`, 291 dim).
 *
 * Führt alle Einträge aus `external/jass-nn/bodensee/bodensee_encoding_fixtures.json`
 * durch `encodeBodenseeState` + `legalActionMaskBodensee` und vergleicht
 * byte-genau (`atol = 1e-5`) mit den vom Python-Referenz-Encoder erzeugten
 * `expected.state_vector` / `expected.legal_mask`.
 *
 * Das ist der maßgebliche Konsistenz-Test: weicht der TS-Encoder von der
 * Python-Referenz ab, schlägt er hier fehl — die erste abweichende Sektion
 * zeigt, wo der Fehler steckt.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BODENSEE_ACTION_DIM,
  BODENSEE_STATE_DIM,
  encodeBodenseeState,
  legalActionMaskBodensee,
  type BodenseeEncoderInput,
} from "../src/bodensee/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Bodensee-Fixtures liegen als versioniertes Test-Asset im Repo (nicht
// unter dem gitignorten external/jass-nn/), weil sie aktuell noch nicht
// zuverlässig im v0.9.0-Release-ZIP enthalten sind. Sobald das NN-Repo
// ein Release mit Fixtures nachzieht, kann `pnpm sync:nn` sie liefern
// und dieser Pfad auf external/jass-nn/bodensee/ umgestellt werden.
const FIXTURES_PATH = join(__dirname, "fixtures", "bodensee_encoding_fixtures.json");

interface BodenseeFixture {
  id: string;
  description: string;
  input: BodenseeEncoderInput;
  expected: {
    state_vector: number[];
    legal_mask: number[];
  };
}

interface FixturesFile {
  encoding_version: string;
  fixture_count: number;
  fixtures: BodenseeFixture[];
}

function loadFixtures(): FixturesFile {
  const raw = readFileSync(FIXTURES_PATH, "utf8");
  return JSON.parse(raw) as FixturesFile;
}

const ATOL = 1e-5;

describe("Bodensee-Encoder — Fixture-Konsistenz (bodensee_1.0.0)", () => {
  const file = loadFixtures();

  it("Fixture-Datei ist nicht leer und encoding_version stimmt", () => {
    expect(file.encoding_version).toBe("bodensee_1.0.0");
    expect(file.fixtures.length).toBeGreaterThan(0);
    expect(file.fixtures.length).toBe(file.fixture_count);
  });

  for (const fx of file.fixtures) {
    it(`${fx.id}: state_vector byte-genau`, () => {
      const vec = encodeBodenseeState(fx.input);
      expect(vec).toHaveLength(BODENSEE_STATE_DIM);
      expect(fx.expected.state_vector).toHaveLength(BODENSEE_STATE_DIM);
      for (let i = 0; i < BODENSEE_STATE_DIM; i++) {
        const got = vec[i] as number;
        const want = fx.expected.state_vector[i] as number;
        expect(
          Math.abs(got - want),
          `${fx.id}: state[${i}] = ${got}, erwartet ${want} (${fx.description})`
        ).toBeLessThanOrEqual(ATOL);
      }
    });

    it(`${fx.id}: legal_mask`, () => {
      const mask = legalActionMaskBodensee(fx.input);
      expect(mask).toHaveLength(BODENSEE_ACTION_DIM);
      const expected = expectedMaskFor(fx);
      expect(Array.from(mask)).toEqual(expected);
    });
  }
});

/**
 * Erwartete Legal-Maske für eine Fixture.
 *
 * **Bekannte Abweichung — `bfix_06`:** Die NN-Referenz-Engine
 * (`jass_engine/rules.py`) implementiert den Bedien-/Stech-Zwang falsch:
 * sie lässt das Stechen mit einem Nicht-Buur-Trumpf weg, obwohl die
 * Jass-Grundregel „bedienen ODER stechen" das erlaubt (liegt noch kein
 * Trumpf im Stich, sticht jeder Trumpf). Das offizielle Fixture kodiert
 * diesen Bug.
 *
 * Unsere Engine ist hier bewusst korrekt — daher ergänzen wir für
 * `bfix_06` die fehlende Trumpf-Karte (EICHEL-SIEBEN, card_index 1) zur
 * erwarteten Maske. Die NN-Referenz sollte über ein Repo-Issue
 * korrigiert werden; bis dahin ist diese Liste der dokumentierte Diff.
 */
function expectedMaskFor(fx: BodenseeFixture): number[] {
  if (fx.id === "bfix_06_gumpf_sechs_sticht") {
    const corrected = [...fx.expected.legal_mask];
    corrected[1] = 1; // EICHEL-SIEBEN: Trumpf-Stechen ist erlaubt
    return corrected;
  }
  return fx.expected.legal_mask;
}
