import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/state.ts"],
      thresholds: {
        // Plan-Vorgabe für packages/engine: ≥ 95% Coverage.
        // M2-Stand: rules + encoder voll abgedeckt; state.ts ist ein Re-Export-Stub.
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
