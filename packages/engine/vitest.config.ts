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
      // Schwellen = erreichter Stand (Okt 2026, abgerundet), damit die CI
      // jede Verschlechterung meldet. Das Plan-Ziel bleibt 95/95/95/90
      // (lines/functions/statements/branches) — mit jedem neuen Test hier
      // nachziehen, bis es erreicht ist.
      thresholds: {
        lines: 91,
        functions: 91,
        branches: 79,
        statements: 90,
      },
    },
  },
});
