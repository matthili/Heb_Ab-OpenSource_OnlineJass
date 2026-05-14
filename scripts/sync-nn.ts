#!/usr/bin/env tsx
/**
 * Lädt das NN-Artefakt (`jass-nn-vX.Y.Z.zip`) aus einem GitHub-Release des
 * Schwester-Repos und entpackt es nach `external/jass-nn/`.
 *
 * Lauf: `pnpm sync:nn`
 *
 * Datenquellen:
 *   - Version + Repo: package.json#jassNn.{version,repo}
 *
 * Ablauf:
 *   1. Release-Metadaten via GitHub-API holen (öffentliches Repo → kein Token nötig).
 *   2. Asset mit Pattern `jass-nn-*.zip` finden.
 *   3. ZIP nach `external/jass-nn/.cache/<filename>` herunterladen.
 *   4. SHA-256 gegen API-`digest` verifizieren (Schutz gegen korruptes Download).
 *   5. Inhalt nach `external/jass-nn/` entpacken (via `tar -xf`, cross-platform
 *      auf Windows 10+, Linux, macOS).
 *   6. Sanity-Check: `MANIFEST.json` ist da.
 *
 * Idempotent: existiert bereits eine passende `MANIFEST.json` mit gleicher
 * Version, wird der Download übersprungen — außer `--force` ist gesetzt.
 *
 * In Produktion lädt CI das gleiche Asset; lokal entwickeln + CI bauen mit
 * exakt derselben Schnittstelle. Niemals direkt aus dem NN-Repo-Pfad lesen.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, rm, readdir, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import extract from "extract-zip";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_DIR = join(REPO_ROOT, "external", "jass-nn");
const CACHE_DIR = join(TARGET_DIR, ".cache");

const FORCE = process.argv.includes("--force");

interface RootPackageJson {
  jassNn?: { version?: string; repo?: string };
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string;
  size: number;
}

interface ReleaseResponse {
  tag_name: string;
  assets: ReleaseAsset[];
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

async function fetchReleaseMeta(repo: string, version: string): Promise<ReleaseResponse> {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${version}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "vorarlberger-jass-app-sync-nn",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} für ${url}: ${await res.text()}`);
  }
  return (await res.json()) as ReleaseResponse;
}

async function downloadFile(url: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const headers: Record<string, string> = {
    "User-Agent": "vorarlberger-jass-app-sync-nn",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    headers.Accept = "application/octet-stream";
  }
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) {
    throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  }
  // Node 22+: Web-ReadableStream → Node-Readable
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, createWriteStream(target));
}

function sha256OfFile(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

async function extractZipFlattenTopDir(zipPath: string, target: string): Promise<void> {
  // Das ZIP enthält eine Top-Level-Direktorie `jass-nn-vX.Y.Z/`. Wir entpacken
  // in ein Staging-Verzeichnis und schieben den Inhalt der Top-Dir nach `target`,
  // sodass am Ende `target/MANIFEST.json`, `target/tfjs/...` etc. liegt.
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
  const inner = await readdir(top);
  for (const name of inner) {
    await rename(join(top, name), join(target, name));
  }
  await rm(staging, { recursive: true, force: true });
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

  console.info(`[sync-nn] hole Release-Metadaten ...`);
  const release = await fetchReleaseMeta(repo, version);
  const asset = release.assets.find((a) => /^jass-nn-.*\.zip$/.test(a.name));
  if (!asset) {
    throw new Error(
      `Kein Asset 'jass-nn-*.zip' im Release ${version} gefunden. ` +
        `Vorhandene Assets: ${release.assets.map((a) => a.name).join(", ")}`
    );
  }

  // Vorhandenen Ziel-Inhalt aufräumen, Cache behalten wir bewusst nicht zwischen
  // Läufen — eindeutige Reproduzierbarkeit ist wichtiger als Wiederverwendung.
  if (existsSync(TARGET_DIR)) {
    const entries = await readdir(TARGET_DIR);
    for (const e of entries) {
      if (e === ".cache") continue; // cache überleben lassen, aber gleich überschreiben
      await rm(join(TARGET_DIR, e), { recursive: true, force: true });
    }
  }
  await mkdir(CACHE_DIR, { recursive: true });

  const zipLocal = join(CACHE_DIR, asset.name);
  console.info(`[sync-nn] lade ${asset.name} (${asset.size} bytes) ...`);
  await downloadFile(asset.browser_download_url, zipLocal);

  if (asset.digest) {
    // Format der GitHub-API: "sha256:<hex>"
    const expected = asset.digest.replace(/^sha256:/, "").toLowerCase();
    const actual = sha256OfFile(zipLocal);
    if (expected !== actual) {
      throw new Error(
        `SHA-256-Mismatch für ${asset.name}:\n  erwartet: ${expected}\n  aktuell:  ${actual}`
      );
    }
    console.info(`[sync-nn] SHA-256 ok (${actual.slice(0, 16)}...)`);
  } else {
    console.warn(`[sync-nn] kein digest im Release-Asset, SHA-Verifikation übersprungen.`);
  }

  console.info(`[sync-nn] entpacke nach ${TARGET_DIR} ...`);
  await extractZipFlattenTopDir(zipLocal, TARGET_DIR);

  if (!existsSync(join(TARGET_DIR, "MANIFEST.json"))) {
    throw new Error(
      `Sanity-Check fehlgeschlagen: external/jass-nn/MANIFEST.json fehlt nach Entpacken.`
    );
  }
  console.info(`[sync-nn] OK — ${version} gesynct. Folge mit \`pnpm verify:nn\`.`);
}

main().catch((err: unknown) => {
  console.error("[sync-nn] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
