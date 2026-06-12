#!/usr/bin/env node
/**
 * Karten-Assets vom Repo-`assets/cards/` nach `apps/landing/public/cards/`
 * kopieren — damit Astro sie als `/cards/{suit}-{rank}.png` serviert.
 * Die Jass-Schule (/rules) rendert daraus alle Beispiele und Animationen.
 *
 * Gleiches Muster wie `sync-web-cards.mjs` (predev/prebuild, idempotent);
 * bewusst eine eigene kleine Datei statt einer parametrisierten — die zwei
 * Ziele sollen unabhängig bleiben.
 */
import { mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "assets", "cards");
const DST = join(REPO_ROOT, "apps", "landing", "public", "cards");

async function syncDir(src, dst) {
  if (!existsSync(src)) {
    console.error(`[sync-landing-cards] Quelle nicht da: ${src}`);
    console.error(`  Erst 'pnpm import:cards' laufen lassen (oder die Karten manuell ablegen).`);
    process.exit(1);
  }
  await mkdir(dst, { recursive: true });
  let copied = 0;
  let skipped = 0;
  const entries = await readdir(src);
  for (const name of entries) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const sStat = await stat(srcPath);
    if (sStat.isDirectory()) {
      const sub = await syncDir(srcPath, dstPath);
      copied += sub.copied;
      skipped += sub.skipped;
      continue;
    }
    // Idempotenz: skippe, wenn dst gleich neu/neuer ist.
    if (existsSync(dstPath)) {
      const dStat = await stat(dstPath);
      if (dStat.mtimeMs >= sStat.mtimeMs && dStat.size === sStat.size) {
        skipped++;
        continue;
      }
    }
    await copyFile(srcPath, dstPath);
    copied++;
  }
  return { copied, skipped };
}

const { copied, skipped } = await syncDir(SRC, DST);
console.info(`[sync-landing-cards] ${copied} kopiert, ${skipped} unverändert.`);
