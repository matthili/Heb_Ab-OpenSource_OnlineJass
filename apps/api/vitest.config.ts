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
        "src/modules/admin/admin-bootstrap.service.ts", // OnApplicationBootstrap-Hook, nur Integration
        "src/modules/game/*.gateway.ts", // WS-Gateways, nur Integration
        "src/modules/chat/*.gateway.ts", // WS-Gateways, nur Integration
      ],
      // **Coverage-Realität**: Plan-Doc fordert ≥ 80 % für apps/api.
      // Diese Schwelle ist nur erreichbar, wenn Unit- + Integration-
      // Coverage gemerged werden — was wir aktuell nicht tun (Integration-
      // Tests laufen separat über `vitest.integration.config.ts` in
      // Testcontainers, der V8-Coverage-Export wäre nicht trivial).
      //
      // Aktuelle Schwellen sind daher absichtlich auf den **realistischen
      // Unit-Anteil** gesetzt (Stand 2026-05-23: 17–18 %, je Metrik ~1 pt
      // unter dem Ist-Stand, damit echte Regressionen den Build kippen,
      // kleine Schwankungen aber nicht). Was rein unit-testbar ist
      // (Services mit reiner Logik wie `disconnect-vote.ts`,
      // `password-strength.ts`, `pwned-passwords.ts`, `app-secret.service.ts`)
      // hat eigene dedizierte Tests und ist die echte Regressionsmauer.
      //
      // TODO M11: Coverage-Merge via `c8 merge` einbauen, dann Schwelle
      // auf 80 % hochziehen (Plan-Vorgabe).
      thresholds: {
        lines: 17,
        functions: 14,
        branches: 16,
        statements: 17,
      },
    },
  },
});
