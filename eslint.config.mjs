// Root ESLint flat-config — gilt für alle Workspace-Pakete.
// Einzelne Pakete dürfen einen eigenen `eslint.config.mjs` mit Spreads anlegen.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/.astro/**",
      "**/coverage/**",
      "external/**",
      "assets/**",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },
  {
    // NestJS-DI-Klassen werden über Constructor-Param-Types per reflect-metadata
    // aufgelöst — ESLint erkennt das nicht als Runtime-Use und meldet den Import
    // fälschlich als type-only. Für DI-relevante Dateien deshalb die Regel
    // entspannen.
    files: [
      "apps/api/src/**/*.controller.ts",
      "apps/api/src/**/*.service.ts",
      "apps/api/src/**/*.module.ts",
      "apps/api/src/**/*.gateway.ts",
      "apps/api/src/**/*.guard.ts",
      "apps/api/src/**/*.pipe.ts",
      "apps/api/src/**/*.interceptor.ts",
      "apps/api/src/**/*.filter.ts",
      "apps/api/src/**/*.factory.ts",
    ],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  }
);
