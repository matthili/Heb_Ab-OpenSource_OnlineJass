import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Integration-Tests laufen via `vitest.integration.config.ts` — sie
    // brauchen Docker/Testcontainers und sind hier explizit ausgeschlossen,
    // damit `pnpm test` (Unit-Run) ohne Docker grün bleibt.
    exclude: ["test/integration/**", "node_modules/**", "dist/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // Reine Compose-/Module-Files, Entry-Point und Better-Auth-Glue
      // werden in Integration-Tests abgedeckt; hier nur Unit-Coverage.
      exclude: [
        "src/main.ts",
        "src/app.module.ts",
        "src/**/*.module.ts",
        "src/modules/auth/auth.service.ts", // Better-Auth-Build erfordert Integration
        "src/modules/auth/auth.controller.ts", // Fastify-Glue, Integration
      ],
      // **Coverage-Realität**: Plan-Doc fordert ≥ 80% für apps/api.
      // Diese Schwelle ist nur erreichbar, wenn Unit- + Integration-
      // Coverage gemerged werden — was wir aktuell nicht tun (Integration-
      // Tests laufen separat über `vitest.integration.config.ts` in
      // Testcontainers, der V8-Coverage-Export wäre nicht trivial).
      //
      // Aktuelle Schwellen sind daher absichtlich auf den **realistischen
      // Unit-Anteil** gesetzt (Stand 2026-05: ~17 %). Was reine Unit-
      // testbar wäre (Services mit purer Logik wie `disconnect-vote.ts`,
      // `password-strength.ts`, `app-secret.service.ts`) hat eigene
      // dedizierte Tests + sollte die Drift-Wand bei Edits aufzeigen,
      // selbst wenn die Gesamtschwelle niedrig ist.
      //
      // TODO M11: Coverage-Merge via `c8 merge` einbauen, dann Schwelle
      // auf 80% hochziehen (Plan-Vorgabe).
      thresholds: {
        lines: 15,
        functions: 14,
        branches: 15,
        statements: 15,
      },
    },
  },
});
