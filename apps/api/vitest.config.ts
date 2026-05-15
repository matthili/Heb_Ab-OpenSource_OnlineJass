import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
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
    },
  },
});
