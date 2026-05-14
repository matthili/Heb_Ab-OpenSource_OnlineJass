#!/usr/bin/env tsx
/**
 * Migriert die in `jasskarten-assets/` abgelegten PNGs nach `assets/cards/`
 * mit der projektweit verwendeten Verzeichnis-Struktur.
 *
 * Lauf: `pnpm import:cards`
 *
 * Quelle → Ziel:
 *   jasskarten-assets/karten/       → assets/cards/
 *   jasskarten-assets/farbsymbole/  → assets/cards/suits/
 *   jasskarten-assets/faecher/      → assets/cards/overview/
 *
 * Idempotent: existierende Ziele werden überschrieben. Bricht ab, falls die
 * Quelle nicht vorhanden ist.
 */
import { mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = join(REPO_ROOT, "jasskarten-assets");
const TARGET_ROOT = join(REPO_ROOT, "assets", "cards");

const MAPPING: Array<{ from: string; to: string }> = [
  { from: "karten", to: "." },
  { from: "farbsymbole", to: "suits" },
  { from: "faecher", to: "overview" },
];

async function copyDir(src: string, dst: string): Promise<number> {
  await mkdir(dst, { recursive: true });
  let count = 0;
  const entries = await readdir(src);
  for (const name of entries) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const s = await stat(srcPath);
    if (s.isDirectory()) {
      count += await copyDir(srcPath, dstPath);
    } else if (s.isFile()) {
      await copyFile(srcPath, dstPath);
      count++;
    }
  }
  return count;
}

async function main(): Promise<void> {
  if (!existsSync(SOURCE_ROOT)) {
    console.error(`[import-cards] Quelle nicht gefunden: ${SOURCE_ROOT}`);
    console.error(
      "  Erwartet: jasskarten-assets/ im Repo-Root mit Unterordnern karten/, farbsymbole/, faecher/."
    );
    process.exit(1);
  }

  console.info(`[import-cards] Quelle: ${SOURCE_ROOT}`);
  console.info(`[import-cards] Ziel:   ${TARGET_ROOT}`);

  let totalFiles = 0;
  for (const { from, to } of MAPPING) {
    const src = join(SOURCE_ROOT, from);
    const dst = to === "." ? TARGET_ROOT : join(TARGET_ROOT, to);
    if (!existsSync(src)) {
      console.warn(`[import-cards] Überspringe fehlende Quelle: ${src}`);
      continue;
    }
    const n = await copyDir(src, dst);
    console.info(`[import-cards] ${from}/ → ${dst}: ${n} Dateien`);
    totalFiles += n;
  }

  console.info(`[import-cards] Fertig. ${totalFiles} Dateien insgesamt kopiert.`);
}

main().catch((err: unknown) => {
  console.error("[import-cards] Fehler:", err);
  process.exit(1);
});
