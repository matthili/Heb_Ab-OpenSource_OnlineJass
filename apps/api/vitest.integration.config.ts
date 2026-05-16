/**
 * Vitest-Config für Integration-Tests.
 *
 * Unterschiede zu `vitest.config.ts` (Unit):
 *   - Eigene `include`-Glob: nur `test/integration/`.
 *   - Single-Fork-Pool: alle Test-Files teilen sich einen Worker, damit unser
 *     Singleton-Setup (PG-Container + Redis + NestJS-App) genau einmal pro
 *     `vitest run` hochgefahren wird. Sonst würde jede File 10 s
 *     Container-Boot zahlen.
 *   - Längere Timeouts: Container-Start dauert auf Windows-Docker leicht 30 s.
 *   - Globaler Teardown: schließt App + stoppt Container am Worker-Ende.
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
  // Vitest 4: `pool` und `poolOptions` sind top-level, nicht mehr unter `test`.
  pool: "forks",
  poolOptions: {
    forks: {
      singleFork: true,
    },
  },
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    // Container-Bootstrap (PG, Redis, Stub, App, Migrate) braucht im Worst-Case
    // (Cold-Image-Pull) deutlich länger als der Default-Hook-Timeout (10 s).
    hookTimeout: 120_000,
    testTimeout: 60_000,
    teardownTimeout: 30_000,
    globalSetup: ["./test/integration/global-teardown.ts"],
  },
});
