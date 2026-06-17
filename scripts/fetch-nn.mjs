#!/usr/bin/env node
/**
 * **gh-freier NN-Modell-Downloader** — holt die TF.js-Modelle aus den
 * ÖFFENTLICHEN GitHub-Releases von JCN9000 über die REST-API + `fetch`
 * (kein `gh`, kein Token nötig, solange das Repo public ist).
 *
 * Zweck: Self-Host/Tunnel sollen NN auch ohne manuelles `pnpm sync:nn` +
 * scp bekommen. Der Inferenz-Container ruft dieses Script beim Start auf,
 * wenn `MODEL_DIR` leer ist (siehe apps/inference/docker-entrypoint.sh).
 * Läuft genauso auf einem Host: `node scripts/fetch-nn.mjs`.
 *
 * Spiegelt die Lade-/Entpack-Logik von scripts/sync-nn.ts (gleiches Ziel-
 * Layout `MODEL_DIR/<gameType>/`, gleiche `jass-nn-*.zip`-Assets, gleicher
 * MANIFEST-Check), nur ohne die `gh`-Abhängigkeit.
 *
 * Idempotent: ein Modell, dessen MANIFEST.json schon zur gepinnten Version
 * passt, wird übersprungen (außer `--force`). Fehler pro Modell werden
 * geloggt, brechen aber NICHT den ganzen Lauf ab — der Server soll im
 * Zweifel trotzdem starten (die API fällt ohnehin auf die Heuristik zurück).
 *
 * Quelle der Versionen: package.json#jassNn.{repo,models}.
 * Optional `GITHUB_TOKEN`/`GH_TOKEN` (nur fürs API-Rate-Limit, nicht nötig).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

/**
 * Entpackt ein ZIP nach `dir`. Bevorzugt `extract-zip` (auf Host/CI vorhanden);
 * fällt zurück auf System-`unzip` (im schlanken Inferenz-Container per apk
 * installiert, dort gibt es kein extract-zip).
 */
async function unzipInto(zipPath, dir) {
  try {
    const { default: extract } = await import("extract-zip");
    await extract(zipPath, { dir });
    return;
  } catch {
    /* extract-zip nicht verfügbar/fehlgeschlagen → System-unzip versuchen */
  }
  await new Promise((res, rej) => {
    const p = spawn("unzip", ["-q", "-o", zipPath, "-d", dir], { stdio: "inherit" });
    p.on("error", rej);
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`unzip → exit ${code}`))));
  });
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// MODEL_DIR kann per Env überschrieben werden (Container: /app/external/jass-nn).
const BASE_DIR = process.env.MODEL_DIR
  ? resolve(process.env.MODEL_DIR)
  : join(REPO_ROOT, "external", "jass-nn");

const FORCE = process.argv.includes("--force");
const SELECTED = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function loadConfig() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const repo = pkg.jassNn?.repo;
  const models = pkg.jassNn?.models;
  if (!repo || !models || Object.keys(models).length === 0) {
    throw new Error("package.json#jassNn.{repo,models} fehlt oder leer.");
  }
  return { repo, models };
}

function alreadyUpToDate(gameType, version) {
  if (FORCE) return false;
  const manifestPath = join(BASE_DIR, gameType, "MANIFEST.json");
  if (!existsSync(manifestPath)) return false;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")).release_version === version;
  } catch {
    return false;
  }
}

function authHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const h = { Accept: "application/vnd.github+json", "User-Agent": "heb-ab-fetch-nn" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Asset-Download-URL des `jass-nn-*.zip` für ein Release-Tag (public API). */
async function findAssetUrl(repo, tag) {
  const api = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
  const res = await fetch(api, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub-API ${api} → HTTP ${res.status} ${res.statusText}`);
  }
  const release = await res.json();
  const asset = (release.assets ?? []).find((a) => /^jass-nn-.*\.zip$/.test(a.name));
  if (!asset) {
    throw new Error(`Kein jass-nn-*.zip-Asset im Release ${tag} von ${repo}.`);
  }
  return asset.browser_download_url;
}

async function downloadTo(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": "heb-ab-fetch-nn" }, redirect: "follow" });
  if (!res.ok) throw new Error(`Download ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

/** Entpackt das ZIP nach `target` und flacht die `jass-nn-*`-Top-Dir ab. */
async function extractFlatten(zipPath, target) {
  const staging = join(target, ".staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await unzipInto(zipPath, staging);
  const entries = await readdir(staging);
  const topDirs = entries.filter((e) => /^jass-nn-/i.test(e));
  if (topDirs.length !== 1) {
    throw new Error(`Unerwartete ZIP-Struktur: ${entries.join(", ")} (erwartet eine 'jass-nn-*' Top-Dir)`);
  }
  const top = join(staging, topDirs[0]);
  for (const name of await readdir(top)) {
    await rename(join(top, name), join(target, name));
  }
  await rm(staging, { recursive: true, force: true });
}

async function clearDir(dir) {
  if (!existsSync(dir)) return;
  for (const e of await readdir(dir)) await rm(join(dir, e), { recursive: true, force: true });
}

async function fetchModel(repo, gameType, cfg) {
  const targetDir = join(BASE_DIR, gameType);
  if (alreadyUpToDate(gameType, cfg.version)) {
    console.info(`[fetch-nn] ${gameType}: MANIFEST passt zu ${cfg.version} — übersprungen.`);
    return false;
  }
  console.info(`[fetch-nn] ${gameType}: lade ${cfg.version} aus ${repo} (public) ...`);
  const url = await findAssetUrl(repo, cfg.version);
  await clearDir(targetDir);
  await mkdir(targetDir, { recursive: true });
  const tmpZip = join(tmpdir(), `jass-nn-${gameType}-${cfg.version}.zip`);
  await downloadTo(url, tmpZip);
  await extractFlatten(tmpZip, targetDir);
  await rm(tmpZip, { force: true });
  if (!existsSync(join(targetDir, "MANIFEST.json"))) {
    throw new Error(`MANIFEST.json fehlt in ${targetDir} nach Entpacken.`);
  }
  if (cfg.encodingVersion) {
    const m = JSON.parse(readFileSync(join(targetDir, "MANIFEST.json"), "utf8"));
    if (m.encoding_version !== cfg.encodingVersion) {
      throw new Error(
        `${gameType}: MANIFEST encoding_version ${m.encoding_version} ≠ erwartet ${cfg.encodingVersion}.`
      );
    }
  }
  console.info(`[fetch-nn] ${gameType}: OK — ${cfg.version} geladen.`);
  return true;
}

async function main() {
  const { repo, models } = loadConfig();
  const gameTypes = SELECTED.length > 0 ? SELECTED : Object.keys(models);
  console.info(`[fetch-nn] Ziel: ${BASE_DIR}`);
  console.info(`[fetch-nn] Repo: ${repo} — Modelle: ${gameTypes.join(", ")}`);
  let ok = 0;
  let failed = 0;
  for (const gt of gameTypes) {
    const cfg = models[gt];
    if (!cfg) {
      console.warn(`[fetch-nn] Unbekannte Spielart '${gt}' — übersprungen.`);
      continue;
    }
    try {
      await fetchModel(repo, gt, cfg);
      ok++;
    } catch (err) {
      // Pro-Modell-Fehler NICHT fatal: Server startet trotzdem (Heuristik-Fallback).
      failed++;
      console.error(`[fetch-nn] ${gt}: FEHLER — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.info(`[fetch-nn] Fertig — ${ok} ok, ${failed} fehlgeschlagen.`);
}

main().catch((err) => {
  console.error("[fetch-nn] Abbruch:", err instanceof Error ? err.message : err);
  // Bewusst Exit 0: ein fehlgeschlagener Auto-Download soll den Container-Start
  // NICHT verhindern — ohne Modelle nutzt die App eben die Heuristik.
  process.exit(0);
});
