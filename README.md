# Vorarlberger Kreuz-Jass — Web-Plattform

Selbst-hostbare Multiplayer-Plattform für **Vorarlberger Kreuz-Jass**, auf der echte Menschen gegen- und miteinander spielen können — wahlweise mit KI-Gegnern, die ein neuronales Netz aus dem Schwester-Projekt [`jass-neuronales-netz`](../jass_neuronales_netz/) nutzen.

> **Status:** M0 — Repo- und CI-Skelett. Implementierung folgt schrittweise gemäß [Architektur-Plan](./docs/ARCHITECTURE.md).

## Vision

- **Lobby + Tische** mit drei Beitritts-Modi (offen / auf Anfrage / nur Einladung)
- **Server-autoritative Spielmechanik** über WebSockets — Cheaten clientseitig nicht möglich
- **KI-Mitspieler** über einen eigenen Inferenz-Microservice mit TF.js-Modell
- **Chat** in Lobby, am Tisch und als Privatnachricht — mit Markdown-light + Sanitization
- **Admin-Panel** für SMTP-Setup, Blocklist, User-Mgmt, Audit-Log
- **Skaliert** von „ein Container auf dem NAS" bis „k8s-Cluster für 200+ Spieler"
- **DSGVO**-konform, **WCAG 2.1 AA**, **PWA**-installierbar, **i18n** (DE-Vorarlberg + EN)

## Tech-Stack (Highlights)

| Schicht          | Wahl                                                       |
| ---------------- | ---------------------------------------------------------- |
| Monorepo         | pnpm workspaces + Turborepo                                |
| Sprache          | TypeScript 5 strict                                        |
| Frontend-Spiel   | React 19 + Vite + TanStack Router/Query + Tailwind + Radix |
| Frontend-Landing | Astro 4 + React-Islands                                    |
| Backend          | NestJS 11 + Fastify                                        |
| API-Stil         | REST (OpenAPI) + WebSocket (Socket.IO)                     |
| DB               | PostgreSQL 16 + Prisma 5                                   |
| Cache/Pub-Sub    | Redis 7                                                    |
| Auth             | Lucia v3 + Argon2id                                        |
| KI-Inferenz      | eigener Microservice mit `@tensorflow/tfjs-node`           |
| Reverse Proxy    | Caddy 2                                                    |
| Container        | Docker Compose (Dev/NAS) + Helm (k8s)                      |

Vollständige Begründung pro Schicht: siehe [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Quickstart (für M0-Stand)

```powershell
# Voraussetzungen: Node 24+, pnpm 10+, gh CLI (für NN-Artefakt-Download in M1)

pnpm install
pnpm import:cards    # migriert jasskarten-assets/ → assets/cards/
pnpm typecheck       # Workspace-übergreifender TS-Check
pnpm lint            # ESLint über alle Pakete
```

## Repository-Layout

```
.
├── apps/
│   ├── landing/        # Astro-Site (M7)
│   ├── web/            # React-PWA (M7)
│   ├── api/            # NestJS-Backend (M3+)
│   └── inference/      # tfjs-node Microservice (M5)
├── packages/
│   ├── engine/         # TS-Port der Jass-Engine (M2)
│   ├── shared-types/   # OpenAPI-Client + WS-Events
│   ├── ui/             # geteilte React-Komponenten
│   └── config/         # tsconfig-/eslint-/prettier-Basis
├── assets/cards/       # Karten-PNGs (migriert von jasskarten-assets/)
├── external/jass-nn/   # NN-Artefakt — `pnpm sync:nn` (gitignored)
├── infra/              # docker-compose, caddy, helm
├── scripts/            # import-cards, sync-nn, verify-nn-manifest
└── docs/               # ARCHITECTURE, SECURITY, NN-CONTRACT, ADRs
```

## Meilenstein-Roadmap

| ID  | Inhalt                                                        | Status        |
| --- | ------------------------------------------------------------- | ------------- |
| M0  | Repo & CI-Skelett, Karten-Assets                              | **in Arbeit** |
| M1  | NN-Artefakt-Pipeline (TF.js-Export im NN-Repo, Sync-Workflow) | offen         |
| M2  | TS-Port der Engine + Encoder, Fixture-Tests                   | offen         |
| M3  | NestJS-API mit Lucia-Auth, Postgres, Mail                     | offen         |
| M4  | WS-Gateway + Single-Table-Game-Loop                           | offen         |
| M5  | Inferenz-Microservice mit echtem NN                           | offen         |
| M6  | Lobby + Tisch-Modi + KI-Auffüllung                            | offen         |
| M7  | Frontend-Hauptansichten + Landing + E2E                       | offen         |
| M8  | Chat (3 Kanäle) + Markdown-Sanitization                       | offen         |
| M9  | Admin-Panel + SMTP-Config + Audit-Log                         | offen         |
| M10 | Replays, Statistiken, Profil-History, DSGVO                   | offen         |
| M11 | PWA-Polish, i18n, a11y-Sweep, k8s-Helm                        | offen         |

Details: siehe [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §8.

## Schwester-Projekt

Spielregeln, Encoding-Spec und das trainierte Modell kommen aus dem unabhängigen Python-Projekt:

- **Pfad lokal:** `G:\Claude_Projekte\jass_neuronales_netz\`
- **Wie integriert:** versionierter Asset-Download (siehe [`docs/NN-CONTRACT.md`](./docs/NN-CONTRACT.md))

Die Web-App **darf Spielregeln nicht duplizieren** — Single-Source-of-Truth ist `external/jass-nn/jass_rules.json`.

## Lizenz

UNLICENSED — derzeit privates Projekt.
