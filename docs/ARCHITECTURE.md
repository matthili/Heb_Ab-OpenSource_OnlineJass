# Architektur — Heb ab!

> Lebendes Dokument. Projektname: **„Heb ab!"** — der OpenSource-Jass nach vorarlberger Spielart. Quelle der konkreten Begründungen ist der vom Nutzer abgenommene Implementierungs-Plan (`C:\Users\matth\.claude\plans\projekt-vorarlberger-jass-app-vast-kahn.md`).

## Überblick

Drei Apps, vier Pakete, ein Reverse-Proxy:

```
┌──────────┐   ┌──────┐   ┌─────┐
│ landing  │   │ web  │   │ api │ ←─── inference
│ (Astro)  │   │(React│   │(Nest│
└──────────┘   │ PWA) │   │ JS) │
               └──────┘   └─────┘
                  ▲          ▲
                  │          │ sticky WS via Caddy
                  └──────────┘
                       │
                  PostgreSQL + Redis
```

- **`apps/landing/`** — Astro-Site für Marketing, Regeln, Datenschutz, Impressum. Statisch gebaut, React-Islands für interaktive Demos.
- **`apps/web/`** — React-SPA (das eigentliche Spiel + Lobby). PWA-installierbar.
- **`apps/api/`** — NestJS-Backend (REST + Socket.IO-Gateway). Server-autoritativer Spielzustand.
- **`apps/inference/`** — TF.js-Node-Microservice für die KI-Züge.

Geteilte Logik:

- **`packages/engine/`** — TS-Port der Jass-Regeln + 132-dim State-Encoder. Quelle der Wahrheit für API _und_ Inference. Generiert aus `jass_rules.json`.
- **`packages/shared-types/`** — OpenAPI-Client + WebSocket-Event-Discriminated-Unions + Zod-Schemas.
- **`packages/ui/`** — Card, Hand, Trick, Scoreboard, ChatBubble.
- **`packages/config/`** — geteilte tsconfig-/eslint-/prettier-Basis.

## Schichtarchitektur

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser (PWA, React+Vite) — apps/web                                   │
│  ├─ TanStack Router/Query                                               │
│  ├─ Socket.IO Client                                                    │
│  └─ Service Worker (offline shell, card assets cached)                  │
│                                                                          │
│  Marketing — apps/landing (Astro)                                       │
└──────────┬──────────────┬───────────────────────────────────────────────┘
           │ HTTPS         │ WSS
           ▼              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Caddy Reverse Proxy                                                    │
│  - Auto-TLS, HSTS, CSP                                                  │
│  - /             → landing (static)                                     │
│  - /app/*        → web (SPA fallback)                                   │
│  - /api/*        → api (round-robin)                                    │
│  - /ws/*         → api (sticky ip_hash)                                 │
└──────────┬───────────────────────────────────────┬──────────────────────┘
           ▼                                       ▼
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  apps/api (NestJS+Fastify)  │         │  apps/web + apps/landing      │
│  ├─ REST Controllers        │         │  (statisch via Caddy)         │
│  ├─ Socket.IO Gateway       │         └──────────────────────────────┘
│  ├─ Better Auth (Sessions PG)│
│  ├─ Prisma Client           │
│  ├─ Game Service (autorit.) │
│  └─ Inference HTTP Client ──┼─────┐
└──────────┬───────────────┬──┘     │
           ▼               ▼        ▼
┌────────────────┐ ┌──────────────────┐ ┌────────────────────────────────┐
│ PostgreSQL 16  │ │ Redis 7          │ │ apps/inference                 │
│ - User/Profile │ │ - Socket.IO Adp  │ │ - tfjs-node + Piscina-Pool     │
│ - Game/Move    │ │ - Live GameState │ │ - POST /predict {state, mask}  │
│ - ChatMessage  │ │ - Presence Sets  │ │ - Encoding-Version-Check       │
│ - AuditLog     │ │ - Rate-Limit     │ │                                │
│ - Sessions     │ │ - Chat-Stream    │ └────────────────────────────────┘
└────────────────┘ └──────────────────┘
```

Mehr Details (Datenmodell, Auth-Flow, KI-Integration, Tests-Pyramide) im Plan-Dokument.

## Tech-Stack-Entscheidungen — Verweis auf ADRs

| Entscheidung                             | ADR                                                  |
| ---------------------------------------- | ---------------------------------------------------- |
| pnpm + Turborepo statt Nx                | [0001](./ADRs/0001-monorepo-pnpm-turborepo.md)       |
| REST + WS statt tRPC                     | [0002](./ADRs/0002-rest-and-ws-not-trpc.md)          |
| Better Auth statt Lucia/Auth.js/Passport | [0003](./ADRs/0003-lucia-not-authjs.md)              |
| Inferenz als eigener Microservice        | [0004](./ADRs/0004-inference-as-separate-service.md) |

## Sicherheit

Siehe [`SECURITY.md`](./SECURITY.md) für die Checkliste, was ab welchem Meilenstein eingebaut wird.

## NN-Schnittstelle

Siehe [`NN-CONTRACT.md`](./NN-CONTRACT.md) für die exakte Schnittstelle zum Schwester-Projekt: Welche Artefakte werden konsumiert, wie versioniert, wie verifiziert.

## Meilenstein-Roadmap

Siehe Plan-Dokument §8. Kurzfassung im [README](../README.md).
