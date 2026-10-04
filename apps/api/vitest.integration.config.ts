/**
 * Vitest-Config für Integration-Tests.
 *
 * Unterschiede zu `vitest.config.ts` (Unit):
 *   - Eigene `include`-Glob: nur `test/integration/`.
 *   - Ein Worker ohne Isolation (`maxWorkers: 1`, `isolate: false`): alle
 *     Test-Files teilen sich einen Prozess, damit unser Singleton-Setup
 *     (PG-Container + Redis + NestJS-App) genau einmal pro `vitest run`
 *     hochgefahren wird. Sonst zahlt jede File den Container-Boot selbst.
 *   - Längere Timeouts: Container-Start dauert auf Windows-Docker leicht 30 s.
 *   - Globaler Teardown: läuft im Vitest-Hauptprozess, nicht im Worker — dort
 *     gibt es kein Singleton, er bewirkt nichts (siehe global-teardown.ts).
 *   - Kein Coverage: Integration-Tests sind teuer; die Coverage-Schwellen für
 *     CI laufen über `pnpm test:coverage` (Unit).
 */
import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  // SWC als Transformer — Vitest's esbuild emittet kein `design:paramtypes`,
  // ohne das funktioniert NestJS-Constructor-DI nicht (alle Provider werden
  // `undefined`). SWC mit `decoratorMetadata: true` schreibt die Metadata in
  // den transpilierten Code, sodass `reflect-metadata` zur Laufzeit die
  // Param-Typen rekonstruieren kann.
  plugins: [
    swc.vite({
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    // Alle Test-Files laufen nacheinander in EINEM Worker-Prozess, und dessen
    // Modul-Cache bleibt zwischen den Files erhalten → das Singleton in
    // setup.ts fährt Container + App genau einmal hoch. Vitest 4 hat
    // `poolOptions.forks.singleFork` entfernt; Ersatz laut Migrationsleitfaden
    // („Pool Rework") ist `maxWorkers: 1` + `isolate: false`, beides unter `test`.
    // Die frühere Variante (`poolOptions` auf oberster Ebene) hat Vitest nie
    // gelesen — jede File bekam einen eigenen Prozess samt eigener Container.
    pool: "forks",
    maxWorkers: 1,
    isolate: false,
    // Container-Bootstrap (PG, Redis, Stub, App, Migrate) braucht im Worst-Case
    // (Cold-Image-Pull) deutlich länger als der Default-Hook-Timeout (10 s).
    hookTimeout: 120_000,
    testTimeout: 60_000,
    teardownTimeout: 30_000,
    globalSetup: ["./test/integration/global-teardown.ts"],
  },
});
