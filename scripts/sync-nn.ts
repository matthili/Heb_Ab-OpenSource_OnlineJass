#!/usr/bin/env tsx
/**
 * Lädt die NN-Artefakte (`jass-nn-vX.Y.Z.zip`) aus GitHub-Releases des
 * Schwester-Repos via `gh release download` und entpackt sie nach
 * `external/jass-nn/<gameType>/`.
 *
 * **Multi-Modell** (seit der 3-Spielarten-Integration): Die App nutzt drei
 * unabhängige Modelle — Kreuz-Jass, Solo-Jass, Bodensee-Jass. Jedes hat
 * eine eigene Release-Version und liegt in einem eigenen Unterordner:
 *
 *   external/jass-nn/
 *     kreuz/    ← v0.7.0  (encoding 3.0.0)
 *     solo/     ← v0.8.0  (encoding 3.0.0)
 *     bodensee/ ← v0.9.0  (encoding bodensee_1.0.0)
 *
 * Lauf: `pnpm sync:nn`               (idempotent, alle Modelle)
 *       `pnpm sync:nn --force`       (erzwingt Neudownload aller)
 *       `pnpm sync:nn kreuz solo`    (nur ausgewählte Modelle)
 *
 * Voraussetzung: GitHub CLI (`gh`) installiert und authentifiziert.
 *   - Lokal: `gh auth login` (einmalig)
 *   - CI:    Umgebungsvariable `GH_TOKEN` setzen.
 *
 * Datenquellen: package.json#jassNn.{repo,models}
 *
 * Die anschließende Datei-für-Datei-Hash-Verifikation läuft separat über
 * `pnpm verify:nn` (siehe scripts/verify-nn-manifest.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import extract from "extract-zip";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_DIR = join(REPO_ROOT, "external", "jass-nn");
const CACHE_DIR = join(BASE_DIR, ".cache");

const FORCE = process.argv.includes("--force");
/** Optionale Positional-Args = Teilmenge der zu syncenden Spielarten. */
const SELECTED = process.argv.slice(2).filter((a) => !a.startsWith("--"));

interface ModelConfig {
  version: string;
  encodingVersion?: string;
  specVersion?: string;
}

interface RootPackageJson {
  jassNn?: {
    repo?: string;
    models?: Record<string, ModelConfig>;
  };
}

interface ExistingManifest {
  release_version?: string;
}

function loadConfig(): { repo: string; models: Record<string, ModelConfig> } {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as RootPackageJson;
  const repo = pkg.jassNn?.repo;
  const models = pkg.jassNn?.models;
  if (!repo || !models || Object.keys(models).length === 0) {
    throw new Error("package.json#jassNn.{repo,models} fehlt oder leer.");
  }
  return { repo, models };
}

/** Ein Modell ist aktuell, wenn sein MANIFEST.json zur gepinnten Version passt. */
function alreadyUpToDate(gameType: string, version: string): boolean {
  if (FORCE) return false;
  const manifestPath = join(BASE_DIR, gameType, "MANIFEST.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as ExistingManifest;
    return m.release_version === version;
  } catch {
    return false;
  }
}

/**
 * Lokalisiert die `gh`-Binary. Versucht erst den PATH, dann Windows-
 * Standard-Installationspfade.
 */
function findGh(): string {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\GitHub CLI\\gh.exe",
      "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }
  return "gh";
}

function runGh(args: string[]): Promise<void> {
  const bin = findGh();
  return new Promise((resolveProc, rejectProc) => {
    const proc = spawn(bin, args, { stdio: "inherit" });
    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        rejectProc(
          new Error(
            `GitHub CLI ('gh') nicht gefunden. Installation: https://cli.github.com/ — danach \`gh auth login\`.`
          )
        );
      } else {
        rejectProc(err);
      }
    });
    proc.on("exit", (code) => {
      if (code === 0) resolveProc();
      else rejectProc(new Error(`gh ${args.join(" ")} → exit code ${code}`));
    });
  });
}

/** Entpackt das ZIP nach `target` und flacht die `jass-nn-*`-Top-Dir ab. */
async function extractZipFlattenTopDir(zipPath: string, target: string): Promise<void> {
  const staging = join(target, ".staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  await extract(zipPath, { dir: staging });

  const entries = await readdir(staging);
  const topDirs = entries.filter((e) => /^jass-nn-/i.test(e));
  if (topDirs.length !== 1) {
    throw new Error(
      `Unerwartete ZIP-Struktur: ${entries.join(", ")} (erwartet genau eine 'jass-nn-*' Top-Dir)`
    );
  }
  const top = join(staging, topDirs[0] as string);
  for (const name of await readdir(top)) {
    await rename(join(top, name), join(target, name));
  }
  await rm(staging, { recursive: true, force: true });
}

/** Räumt das Zielverzeichnis (z.B. external/jass-nn/solo) leer. */
async function clearDir(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  for (const e of await readdir(dir)) {
    await rm(join(dir, e), { recursive: true, force: true });
  }
}

/**
 * Synct ein einzelnes Modell für eine Spielart in seinen Unterordner.
 */
async function syncModel(repo: string, gameType: string, cfg: ModelConfig): Promise<boolean> {
  const targetDir = join(BASE_DIR, gameType);
  if (alreadyUpToDate(gameType, cfg.version)) {
    console.info(`[sync-nn] ${gameType}: MANIFEST passt zu ${cfg.version} — übersprungen.`);
    return false;
  }

  await clearDir(targetDir);
  await mkdir(targetDir, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  // Pro-Spielart eigenes Cache-Unterverzeichnis, damit parallele
  // Versionen sich nicht in die Quere kommen.
  const cacheSub = join(CACHE_DIR, gameType);
  await rm(cacheSub, { recursive: true, force: true });
  await mkdir(cacheSub, { recursive: true });

  console.info(`[sync-nn] ${gameType}: gh release download ${cfg.version} ...`);
  await runGh([
    "release",
    "download",
    cfg.version,
    "--repo",
    repo,
    "--pattern",
    "jass-nn-*.zip",
    "--dir",
    cacheSub,
    "--clobber",
  ]);

  const zips = (await readdir(cacheSub)).filter((n) => /^jass-nn-.*\.zip$/.test(n));
  if (zips.length === 0) {
    throw new Error(`Kein jass-nn-*.zip in ${cacheSub} nach gh release download.`);
  }
  if (zips.length > 1) {
    throw new Error(`Mehrere jass-nn-*.zip in ${cacheSub}: ${zips.join(", ")}.`);
  }
  const zipPath = join(cacheSub, zips[0] as string);

  console.info(`[sync-nn] ${gameType}: entpacke ${zips[0]} → ${targetDir} ...`);
  await extractZipFlattenTopDir(zipPath, targetDir);

  if (!existsSync(join(targetDir, "MANIFEST.json"))) {
    throw new Error(`Sanity-Check fehlgeschlagen: MANIFEST.json fehlt in ${targetDir}.`);
  }

  // Encoding-Version-Sanity: das MANIFEST muss zur erwarteten Version
  // passen — fängt vertauschte Releases früh ab.
  if (cfg.encodingVersion) {
    const m = JSON.parse(readFileSync(join(targetDir, "MANIFEST.json"), "utf8")) as {
      encoding_version?: string;
    };
    if (m.encoding_version !== cfg.encodingVersion) {
      throw new Error(
        `${gameType}: MANIFEST encoding_version ${m.encoding_version} ≠ erwartet ${cfg.encodingVersion}.`
      );
    }
  }
  console.info(`[sync-nn] ${gameType}: OK — ${cfg.version} gesynct.`);
  return true;
}

async function main(): Promise<void> {
  const { repo, models } = loadConfig();
  const gameTypes = SELECTED.length > 0 ? SELECTED : Object.keys(models);

  console.info(`[sync-nn] Repo: ${repo}`);
  console.info(`[sync-nn] Modelle: ${gameTypes.join(", ")}`);

  let synced = 0;
  for (const gt of gameTypes) {
    const cfg = models[gt];
    if (!cfg) {
      throw new Error(`Unbekannte Spielart '${gt}' — nicht in package.json#jassNn.models.`);
    }
    if (await syncModel(repo, gt, cfg)) synced++;
  }

  console.info(
    `[sync-nn] Fertig — ${synced}/${gameTypes.length} Modell(e) neu gesynct. ` +
      `Folge mit \`pnpm verify:nn\`.`
  );
}

main().catch((err: unknown) => {
  console.error("[sync-nn] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
