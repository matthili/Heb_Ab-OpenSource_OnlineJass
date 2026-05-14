#!/usr/bin/env tsx
/**
 * Lädt das NN-Artefakt (`jass-nn-vX.Y.Z.zip`) aus einem GitHub-Release des
 * Schwester-Repos via `gh release download` und entpackt es nach `external/jass-nn/`.
 *
 * Lauf: `pnpm sync:nn`        (idempotent)
 *       `pnpm sync:nn --force` (erzwingt Neudownload)
 *
 * Voraussetzung: GitHub CLI (`gh`) installiert und authentifiziert.
 *   - Lokal: `gh auth login` (einmalig)
 *   - CI:    Umgebungsvariable `GH_TOKEN` setzen (GitHub Actions liefert sie als
 *            `${{ secrets.GITHUB_TOKEN }}` mit Read-Zugang zum eigenen Repo;
 *            für fremde Repos einen Token mit `repo:read` bereitstellen).
 *
 * Datenquellen: package.json#jassNn.{version,repo}
 *
 * Ablauf:
 *   1. Auflösen, wo `gh` liegt (PATH; auf Windows: Standard-Installationspfade).
 *   2. Skippen, wenn `external/jass-nn/MANIFEST.json` schon zur gepinnten Version passt.
 *   3. Ziel-Inhalt aufräumen (außer .cache/).
 *   4. `gh release download <ver> --repo <repo> --pattern jass-nn-*.zip --dir .cache`
 *   5. ZIP entpacken, Top-Level-Direktorie (`jass-nn-vX.Y.Z/`) abflachen.
 *   6. Sanity: MANIFEST.json muss existieren.
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
const TARGET_DIR = join(REPO_ROOT, "external", "jass-nn");
const CACHE_DIR = join(TARGET_DIR, ".cache");

const FORCE = process.argv.includes("--force");

interface RootPackageJson {
  jassNn?: { version?: string; repo?: string };
}

interface ExistingManifest {
  release_version?: string;
}

function loadConfig(): { version: string; repo: string } {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as RootPackageJson;
  const version = pkg.jassNn?.version;
  const repo = pkg.jassNn?.repo;
  if (!version || !repo) {
    throw new Error("package.json#jassNn.{version,repo} fehlt.");
  }
  return { version, repo };
}

function alreadyUpToDate(version: string): boolean {
  if (FORCE) return false;
  const manifestPath = join(TARGET_DIR, "MANIFEST.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as ExistingManifest;
    return m.release_version === version;
  } catch {
    return false;
  }
}

/**
 * Lokalisiert die `gh`-Binary. Versucht erst den PATH (via `process.env.PATH`
 * + plattform-übliche Suffixe), dann Windows-Standard-Installationspfade.
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
  // Auf POSIX-Systemen vertrauen wir darauf, dass `gh` im PATH liegt.
  // child_process.spawn löst PATH automatisch auf.
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

async function clearTargetExceptCache(): Promise<void> {
  if (!existsSync(TARGET_DIR)) return;
  for (const e of await readdir(TARGET_DIR)) {
    if (e === ".cache") continue;
    await rm(join(TARGET_DIR, e), { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { version, repo } = loadConfig();
  console.info(`[sync-nn] gepinnt: ${repo} @ ${version}`);
  console.info(`[sync-nn] Ziel:    ${TARGET_DIR}`);

  if (alreadyUpToDate(version)) {
    console.info(
      `[sync-nn] external/jass-nn/MANIFEST.json passt zur gepinnten Version — übersprungen. (--force erzwingt Neudownload.)`
    );
    return;
  }

  await clearTargetExceptCache();
  await mkdir(CACHE_DIR, { recursive: true });

  // gh release download lädt das passende Asset; --clobber überschreibt evtl.
  // gecachte alte Versionen.
  console.info(`[sync-nn] gh release download ${version} ...`);
  await runGh([
    "release",
    "download",
    version,
    "--repo",
    repo,
    "--pattern",
    "jass-nn-*.zip",
    "--dir",
    CACHE_DIR,
    "--clobber",
  ]);

  // ZIP-Pfad ermitteln (gh nennt das File so wie im Release-Asset benannt).
  const zips = (await readdir(CACHE_DIR)).filter((n) => /^jass-nn-.*\.zip$/.test(n));
  if (zips.length === 0) {
    throw new Error(`Kein jass-nn-*.zip in ${CACHE_DIR} nach gh release download.`);
  }
  if (zips.length > 1) {
    throw new Error(`Mehrere jass-nn-*.zip in ${CACHE_DIR}: ${zips.join(", ")} — bitte aufräumen.`);
  }
  const zipPath = join(CACHE_DIR, zips[0] as string);

  console.info(`[sync-nn] entpacke ${zips[0]} nach ${TARGET_DIR} ...`);
  await extractZipFlattenTopDir(zipPath, TARGET_DIR);

  if (!existsSync(join(TARGET_DIR, "MANIFEST.json"))) {
    throw new Error(`Sanity-Check fehlgeschlagen: MANIFEST.json fehlt nach Entpacken.`);
  }
  console.info(`[sync-nn] OK — ${version} gesynct. Folge mit \`pnpm verify:nn\`.`);
}

main().catch((err: unknown) => {
  console.error("[sync-nn] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
