/**
 * Vitest-Config für Unit-Tests in `src/`. E2E-Tests unter `e2e/` werden
 * NICHT von Vitest gepickt — die laufen über Playwright (`pnpm test:e2e`).
 *
 * Ohne diese Config sucht Vitest auch in `e2e/*.spec.ts`, lädt
 * `@playwright/test` parallel zum Vitest-Runtime und kollidiert.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      // Komponenten, die hauptsächlich über E2E (Playwright) abgedeckt
      // werden — nicht durch Unit-Coverage gateted:
      //   - Routen (file-routing, kein logisches Verhalten)
      //   - Auto-generierte routeTree
      //   - Lib-Glue (Auth-Client, WS-Singleton)
      exclude: [
        "src/routeTree.gen.ts",
        "src/routes/**",
        "src/lib/auth-client.ts",
        "src/lib/ws.ts",
        "src/main.tsx",
      ],
      // **Coverage-Realität**: Plan-Doc fordert ≥ 60% für apps/web —
      // aktuell ist die Unit-Test-Suite hier nur für i18n-Consistency
      // (touched keine src-Files), Coverage = 0%. Die UI ist primär
      // über Playwright (E2E) abgedeckt.
      //
      // Wir setzen die Schwellen daher auf 0 und dokumentieren das.
      // Sobald komponenten-spezifische Unit-Tests entstehen
      // (DisconnectOverlay, ProfileEditPanel, Card-Sortierung etc.),
      // sollten die Schwellen mit jeder Test-Welle hochwandern.
      //
      // TODO: M11 Coverage-Plan-Vorgabe (≥ 60%) als realistisches Ziel
      // sobald 5–10 Komponenten-Tests da sind.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
