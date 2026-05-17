#!/usr/bin/env node
/**
 * Karten-Assets vom Repo-`assets/cards/` nach `apps/web/public/cards/`
 * kopieren — damit Vite sie als `/cards/{suit}-{rank}.png` serviert.
 *
 * Warum keine Symlinks? Auf Windows + Git inkonsistent. Kopie ist
 * pragmatisch: 36 PNGs sind ~2 MB, vernachlässigbar.
 *
 * Lauf: automatisch via `predev`/`prebuild` in `apps/web/package.json`,
 * manuell als `pnpm sync:cards`.
 *
 * Idempotent: kopiert nur, wenn Ziel-Datei fehlt oder älter als Quelle.
 */
import { mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "assets", "cards");
const DST = join(REPO_ROOT, "apps", "web", "public", "cards");

async function syncDir(src, dst) {
  if (!existsSync(src)) {
    console.error(`[sync-web-cards] Quelle nicht da: ${src}`);
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
console.info(`[sync-web-cards] ${copied} kopiert, ${skipped} unverändert.`);
