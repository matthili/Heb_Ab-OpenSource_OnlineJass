/**
 * Playwright-Config für die E2E-Tests der Spiel-SPA (M7-G).
 *
 * **Voraussetzung zum Laufen** (alle in separaten Terminals):
 *   1. `pnpm dev:stack` (Postgres + Redis + Mailhog im Compose)
 *   2. `pnpm --filter @jass/api dev` (API auf :3000)
 *   3. `pnpm --filter @jass/web dev` (SPA auf :5173)
 *   4. Aus dem Repo-Root: `pnpm --filter @jass/web test:e2e`
 *
 * Wir starten den Web-Dev-Server NICHT automatisch via `webServer`, weil:
 *   - die SPA von einer laufenden API abhängt, die Playwright nicht booten
 *     soll (Schemaschritt, Prisma-Generate, Inferenz-Container, …);
 *   - der Schritt-für-Schritt-Stop-and-Inspect-Workflow für M7-G
 *     bequemer ist.
 *
 * Browser-Choice: nur `chromium` für M7-G — das ist der „Plan-Doc-Browser"
 * (Lighthouse PWA-Score wird in M11 dort gemessen). Firefox + WebKit
 * können später in M11 ergänzt werden.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // E2E-Tests teilen sich Mailhog-Inbox + DB-Zustand
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
});
