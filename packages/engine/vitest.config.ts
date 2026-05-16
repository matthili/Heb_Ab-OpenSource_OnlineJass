import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        // Plan-Vorgabe für packages/engine: ≥ 95% Coverage.
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
