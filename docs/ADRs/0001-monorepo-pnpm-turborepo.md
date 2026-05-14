# ADR 0001: Monorepo mit pnpm-Workspaces + Turborepo

- **Status:** akzeptiert
- **Datum:** 2026-05-14

## Kontext

Das Projekt besteht aus mehreren Apps (`landing`, `web`, `api`, `inference`) und geteilten Paketen (`engine`, `shared-types`, `ui`, `config`). Alle in TypeScript. Wir brauchen Build-Caching, Workspace-übergreifende Type-Sharing ohne Doppelpflege, und konsistente Tool-Versionen.

## Optionen

1. **npm/yarn-Workspaces ohne Cache-Tool** — funktioniert, aber Builds werden mit der Repo-Größe langsam.
2. **pnpm-Workspaces + Turborepo** — getrennte Konzepte, beide schlank, Cache via Turborepo.
3. **Nx** — viel Magie, gut für große Polyglott-Repos. Hier overkill: kein Angular, keine plugin-basierten Generatoren nötig.
4. **Lerna** — historisch, aktiv wartungsarm. Nicht empfohlen für neue Repos.

## Entscheidung

**pnpm-Workspaces + Turborepo.**

- pnpm: stabiler Symlink-Store, sehr platzsparend, robust auf Windows.
- Turborepo: einfaches Task-Graph-Caching, sticht out-of-the-box ohne Plugin-Wald.
- Keine Plugin-Architektur, kein Generator-System — wir kommen mit reinen Scripts und tsconfig-Refs aus.

## Konsequenzen

- Alle Pakete leben unter `apps/*` und `packages/*` (pnpm-workspace.yaml).
- `turbo.json` definiert das Task-Graph (build → typecheck → lint → test).
- Bei Wachstum (z.B. Mobile-App via Flutter) ist Nx-Migration möglich, aber heute nicht notwendig.
