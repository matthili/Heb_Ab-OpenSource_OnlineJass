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
      // Statische, unverarbeitete Browser-Assets (z.B. landing/public/*.js) —
      // werden 1:1 ausgeliefert, nicht als TS-Quelle gelintet.
      "**/public/**",
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
      // ── Plan-Doc-Sicherheits-Checkliste #7: "ORM only, kein Raw-SQL ohne Param" ──
      // Prisma hat vier Raw-Methoden:
      //   - $queryRaw         (tagged template, safe — wenn als template aufgerufen)
      //   - $executeRaw       (dito)
      //   - $queryRawUnsafe   (plain string — Injection-Vektor)
      //   - $executeRawUnsafe (dito)
      // Pragmatisch verbieten wir ALLE vier. Wer wirklich Raw-SQL braucht
      // (z.B. komplexe Cross-Table-Migrationen, performance-kritische Views),
      // soll das mit eigenem `// eslint-disable-next-line no-restricted-syntax`
      // + Code-Review-Kommentar bewusst signalisieren.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^\\$(query|execute)Raw(Unsafe)?$/]",
          message:
            "Raw-SQL über Prisma ist verboten (Plan-Doc §9.7). Nutze typsichere Prisma-Client-Methoden, oder disable mit `// eslint-disable-next-line no-restricted-syntax` + Begründung im Review.",
        },
      ],
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
