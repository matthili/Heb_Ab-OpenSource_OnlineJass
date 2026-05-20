#!/usr/bin/env tsx
/**
 * Verifiziert die in `external/jass-nn/<gameType>/` entpackten NN-Artefakte:
 *   - MANIFEST.json existiert pro Spielart
 *   - SHA-256-Hashes aller gelisteten Dateien stimmen
 *   - encoding_version stimmt mit package.json#jassNn.models[gt].encodingVersion
 *   - spec_version    stimmt mit package.json#jassNn.models[gt].specVersion
 *   - release_version stimmt mit package.json#jassNn.models[gt].version
 *
 * **Multi-Modell**: prüft jede Spielart (kreuz/solo/bodensee) einzeln.
 *
 * Lauf: `pnpm verify:nn`              (alle Modelle)
 *       `pnpm verify:nn kreuz solo`   (Teilmenge)
 *
 * MANIFEST-Struktur (Stand NN-Repo v0.1.0): `release_version`/`spec_version`/
 * `encoding_version` + `files: [{path, size_bytes, sha256}]`. Pfade in
 * `files[].path` sind relativ zur ZIP-Wurzel (`jass-nn-vX.Y.Z/...`); für die
 * Verifikation wird der Top-Level-Dir-Prefix abgeschnitten.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_DIR = join(REPO_ROOT, "external", "jass-nn");

const SELECTED = process.argv.slice(2).filter((a) => !a.startsWith("--"));

interface ModelConfig {
  version?: string;
  encodingVersion?: string;
  specVersion?: string;
}
interface RootPackageJson {
  jassNn?: { models?: Record<string, ModelConfig> };
}

interface ManifestFile {
  path: string;
  size_bytes: number;
  sha256: string;
}

interface Manifest {
  release_version?: string;
  spec_version?: string;
  encoding_version?: string;
  files?: ManifestFile[];
}

function sha256(filepath: string): string {
  return createHash("sha256").update(readFileSync(filepath)).digest("hex");
}

function stripTopDir(p: string): string {
  // "jass-nn-v0.1.0/keras/best.keras" → "keras/best.keras"
  const idx = p.indexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

/** Verifiziert ein einzelnes Modell-Verzeichnis. Returnt true bei Erfolg. */
function verifyModel(gameType: string, cfg: ModelConfig): boolean {
  const nnDir = join(BASE_DIR, gameType);
  const manifestPath = join(nnDir, "MANIFEST.json");
  if (!existsSync(manifestPath)) {
    console.error(`[verify-nn] ${gameType}: MANIFEST.json fehlt (${manifestPath}).`);
    console.error(`  Lauf zuerst \`pnpm sync:nn ${gameType}\`.`);
    return false;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  let ok = true;
  const checks: Array<[label: string, expected: string | undefined, actual: string | undefined]> = [
    ["release_version", cfg.version, manifest.release_version],
    ["spec_version", cfg.specVersion, manifest.spec_version],
    ["encoding_version", cfg.encodingVersion, manifest.encoding_version],
  ];
  for (const [label, expected, actual] of checks) {
    if (expected !== actual) {
      console.error(
        `[verify-nn] ${gameType}: ${label}-Mismatch: pin=${expected} vs MANIFEST=${actual}`
      );
      ok = false;
    }
  }

  const files = manifest.files ?? [];
  if (files.length === 0) {
    console.error(`[verify-nn] ${gameType}: MANIFEST.json enthält keine Datei-Einträge.`);
    ok = false;
  }

  for (const f of files) {
    const rel = stripTopDir(f.path);
    const full = join(nnDir, rel);
    if (!existsSync(full)) {
      console.error(`[verify-nn] ${gameType}: Datei fehlt: ${rel}`);
      ok = false;
      continue;
    }
    const size = statSync(full).size;
    if (size !== f.size_bytes) {
      console.error(`[verify-nn] ${gameType}: Größe falsch (${rel}): ${size} vs ${f.size_bytes}`);
      ok = false;
    }
    const actual = sha256(full);
    if (actual !== f.sha256) {
      console.error(
        `[verify-nn] ${gameType}: SHA-256 falsch (${rel}):\n    erwartet: ${f.sha256}\n    aktuell:  ${actual}`
      );
      ok = false;
    }
  }

  if (ok) {
    console.info(
      `[verify-nn] ${gameType}: OK — ${files.length} Datei(en) verifiziert ` +
        `(release=${manifest.release_version}, encoding=${manifest.encoding_version}).`
    );
  }
  return ok;
}

function main(): void {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as RootPackageJson;
  const models = pkg.jassNn?.models;
  if (!models || Object.keys(models).length === 0) {
    console.error("[verify-nn] package.json#jassNn.models fehlt oder leer.");
    process.exit(2);
  }

  const gameTypes = SELECTED.length > 0 ? SELECTED : Object.keys(models);
  let allOk = true;
  for (const gt of gameTypes) {
    const cfg = models[gt];
    if (!cfg) {
      console.error(`[verify-nn] Unbekannte Spielart '${gt}'.`);
      allOk = false;
      continue;
    }
    if (!verifyModel(gt, cfg)) allOk = false;
  }

  if (!allOk) {
    console.error("[verify-nn] FEHLGESCHLAGEN.");
    process.exit(1);
  }
  console.info(`[verify-nn] Alle ${gameTypes.length} Modell(e) OK.`);
}

try {
  main();
} catch (err) {
  console.error("[verify-nn] Fehler:", err);
  process.exit(1);
}
