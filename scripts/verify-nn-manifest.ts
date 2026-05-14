#!/usr/bin/env tsx
/**
 * Verifiziert das in `external/jass-nn/` entpackte NN-Artefakt:
 *   - MANIFEST.json existiert
 *   - SHA-256-Hashes aller gelisteten Dateien stimmen
 *   - encoding_version stimmt mit package.json#jassNn.encodingVersion überein
 *   - spec_version    stimmt mit package.json#jassNn.specVersion überein
 *   - release_version stimmt mit package.json#jassNn.version überein
 *
 * Lauf: `pnpm verify:nn` (CI Pre-Test-Step)
 *
 * Erwartet die MANIFEST-Struktur, wie sie das jass-neuronales-netz-Release-Skript
 * produziert (Stand v0.1.0): `release_version`/`spec_version`/`encoding_version`
 * + `files: [{path, size_bytes, sha256}]`. Pfade in `files[].path` sind
 * relativ zur ZIP-Wurzel (`jass-nn-vX.Y.Z/...`); für die Verifikation wird der
 * Top-Level-Dir-Prefix abgeschnitten.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NN_DIR = join(REPO_ROOT, "external", "jass-nn");
const MANIFEST_PATH = join(NN_DIR, "MANIFEST.json");

interface PinnedConfig {
  version?: string;
  encodingVersion?: string;
  specVersion?: string;
}
interface RootPackageJson {
  jassNn?: PinnedConfig;
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

function main(): void {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`[verify-nn] MANIFEST.json fehlt: ${MANIFEST_PATH}`);
    console.error("  Lauf zuerst `pnpm sync:nn`.");
    process.exit(2);
  }

  const pinned = (
    JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as RootPackageJson
  ).jassNn;
  if (!pinned) {
    console.error("[verify-nn] package.json#jassNn fehlt.");
    process.exit(2);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  let ok = true;
  const checks: Array<[label: string, expected: string | undefined, actual: string | undefined]> = [
    ["release_version", pinned.version, manifest.release_version],
    ["spec_version", pinned.specVersion, manifest.spec_version],
    ["encoding_version", pinned.encodingVersion, manifest.encoding_version],
  ];
  for (const [label, expected, actual] of checks) {
    if (expected !== actual) {
      console.error(`[verify-nn] ${label}-Mismatch: pin=${expected} vs MANIFEST=${actual}`);
      ok = false;
    }
  }

  const files = manifest.files ?? [];
  if (files.length === 0) {
    console.error("[verify-nn] MANIFEST.json enthält keine Datei-Einträge.");
    ok = false;
  }

  for (const f of files) {
    const rel = stripTopDir(f.path);
    const full = join(NN_DIR, rel);
    if (!existsSync(full)) {
      console.error(`[verify-nn] Datei fehlt: ${rel}`);
      ok = false;
      continue;
    }
    const size = statSync(full).size;
    if (size !== f.size_bytes) {
      console.error(`[verify-nn] Größe falsch (${rel}): ${size} vs ${f.size_bytes}`);
      ok = false;
    }
    const actual = sha256(full);
    if (actual !== f.sha256) {
      console.error(
        `[verify-nn] SHA-256 falsch (${rel}):\n    erwartet: ${f.sha256}\n    aktuell:  ${actual}`
      );
      ok = false;
    }
  }

  if (!ok) {
    console.error("[verify-nn] FEHLGESCHLAGEN.");
    process.exit(1);
  }
  console.info(
    `[verify-nn] OK — ${files.length} Datei(en) gegen MANIFEST verifiziert ` +
      `(release=${manifest.release_version}, spec=${manifest.spec_version}, encoding=${manifest.encoding_version}).`
  );
}

try {
  main();
} catch (err) {
  console.error("[verify-nn] Fehler:", err);
  process.exit(1);
}
