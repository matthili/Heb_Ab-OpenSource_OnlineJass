# Heb ab!

> _Der OpenSource-Jass nach vorarlberger Spielart._

Selbst-hostbare Multiplayer-Plattform für **Vorarlberger Kreuz-Jass**, auf der echte Menschen gegen- und miteinander spielen können — wahlweise mit KI-Gegnern, die ein neuronales Netz aus dem Schwester-Projekt [`jass-neuronales-netz`](https://github.com/matthili/jass-neuronales-netz) nutzen.

> **Status:** Drei Spielvarianten spielbar — Kreuz-Jass (4 Spieler), Solo-Jass (4 Spieler), Bodensee-Jass (2 Spieler). Basis-Plattform (Auth, Lobby, WS-Gameplay, Chat, Admin, Replays, PWA) steht. Siehe [Meilenstein-Roadmap](#meilenstein-roadmap).

## Vision

- **Lobby + Tische** mit drei Beitritts-Modi (offen / auf Anfrage / nur Einladung)
- **Server-autoritative Spielmechanik** über WebSockets — Cheaten clientseitig nicht möglich
- **KI-Mitspieler** über einen eigenen Inferenz-Microservice mit TF.js-Modell
- **Chat** in Lobby, am Tisch und als Privatnachricht — mit Markdown-light + Sanitization
- **Admin-Panel** für SMTP-Setup, Blocklist, User-Mgmt, Audit-Log
- **Skaliert** von „ein Container auf dem NAS" bis „k8s-Cluster für 200+ Spieler"
- **DSGVO**-konform, **WCAG 2.1 AA**, **PWA**-installierbar, **i18n** (DE-Vorarlberg + EN)

## Tech-Stack (Highlights)

| Schicht          | Wahl                                                               |
| ---------------- | ------------------------------------------------------------------ |
| Monorepo         | pnpm 10 workspaces + Turborepo                                     |
| Sprache          | TypeScript 5 strict                                                |
| Frontend-Spiel   | React 19 + Vite 8 + TanStack Router/Query + Tailwind 4 + Zustand 5 |
| Frontend-Landing | Astro 6 + React-Islands                                            |
| Backend          | NestJS 11 + Fastify 5                                              |
| API-Stil         | REST (OpenAPI aus Zod) + WebSocket (Socket.IO)                     |
| DB               | PostgreSQL 16 + Prisma 7                                           |
| Cache/Pub-Sub    | Redis 7 (+ Socket.IO-Redis-Adapter)                                |
| Auth             | Better Auth + Argon2id (`@node-rs/argon2`) + Zod 4                 |
| KI-Inferenz      | eigener Microservice mit `@tensorflow/tfjs` (pure-JS)              |
| Reverse Proxy    | Caddy 2                                                            |
| Container        | Docker Compose (Dev/NAS) + Helm (k8s)                              |

Vollständige Begründung pro Schicht: siehe [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
Den Entwicklungs-Verlauf (inkl. bewusster Abweichungen vom Ursprungsplan) erzählt [`docs/JOURNEY.md`](./docs/JOURNEY.md).

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

| ID  | Inhalt                                                                 | Status        |
| --- | ---------------------------------------------------------------------- | ------------- |
| M0  | Repo & CI-Skelett, Karten-Assets                                       | ✅ fertig     |
| M1  | NN-Artefakt-Pipeline (gh release download, Sync-Workflow)              | ✅ fertig     |
| M2  | TS-Port der Engine + Encoder v3.0.0, Fixture-Tests (15 inkl. Gumpf)    | ✅ fertig     |
| M3  | NestJS-API mit Better-Auth, Postgres, Mail (A–E fertig)                | **in Arbeit** |
| M4  | WS-Gateway + Single-Table-Game-Loop                                    | offen         |
| M5  | Inferenz-Microservice mit echtem NN (tfjs/ ist in NN v0.5.0 vorhanden) | bereit        |
| M6  | Lobby + Tisch-Modi + KI-Auffüllung                                     | offen         |
| M7  | Frontend-Hauptansichten + Landing + E2E                                | offen         |
| M8  | Chat (3 Kanäle) + Markdown-Sanitization                                | offen         |
| M9  | Admin-Panel + SMTP-Config + Audit-Log                                  | offen         |
| M10 | Replays, Statistiken, Profil-History, DSGVO                            | offen         |
| M11 | PWA-Polish, i18n, a11y-Sweep, k8s-Helm                                 | offen         |

Details: siehe [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §8.

## Schwester-Projekt

Spielregeln, Encoding-Spec und das trainierte Modell kommen aus dem unabhängigen Python-Projekt:

- **Repo:** [`matthili/jass-neuronales-netz`](https://github.com/matthili/jass-neuronales-netz)
- **Wie integriert:** versionierter Asset-Download (siehe [`docs/NN-CONTRACT.md`](./docs/NN-CONTRACT.md))

Die Web-App **darf Spielregeln nicht duplizieren** — Single-Source-of-Truth ist `external/jass-nn/jass_rules.json`.

## Lizenz

**GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`) — siehe [`LICENSE`](./LICENSE).

Kurz: Nutzen, studieren, weitergeben und verändern ist erlaubt. Wer eine
**veränderte** Version betreibt — auch als Netzwerk-Dienst (also diese Web-App
auf einem Server) — muss seinen Nutzern den vollständigen Quellcode der
veränderten Version unter derselben Lizenz zugänglich machen (AGPL §13).
