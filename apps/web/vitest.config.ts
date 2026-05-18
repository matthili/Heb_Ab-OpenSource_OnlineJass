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
  },
});
