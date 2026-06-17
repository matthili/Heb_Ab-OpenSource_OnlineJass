# syntax=docker/dockerfile:1.7
#
# Dockerfile für @jass/inference — der Inferenz-Microservice.
#
# Multi-Stage:
#   1. `deps`   — pnpm install in einem mageren Layer (Cache-friendly, weil nur
#                 die package.json/Lockfile bestimmen, wann sich was ändert).
#   2. `build`  — Sources rein, `@jass/engine` + `@jass/inference` bauen.
#   3. `runtime`— schlankes Node-Image, prod-deps + dist. Modell selbst kommt
#                 zur Laufzeit per Volume-Mount aus `external/jass-nn/` (siehe
#                 `infra/docker-compose.dev.yml` und `MODEL_DIR`-Env).
#
# Warum Modell NICHT ins Image kopieren?
#   - tfjs/-Files sind ~5 MB pro Release; bei jedem NN-Update neu zu builden
#     ist verschwenderisch.
#   - `external/jass-nn/` wird per `pnpm sync:nn` aktualisiert; das soll auch
#     den Container-Workflow nicht mehr unterbrechen.
#   - In Prod (M11) wird der Modell-Pfad ein PVC / ein Init-Container, der
#     `external/jass-nn/`-Layout aus dem Release-ZIP entpackt.
#
# Build:
#   docker build -f apps/inference/Dockerfile -t jass-inference .
# Run:
#   docker run --rm -p 4000:4000 \
#     -v "$(pwd)/external/jass-nn":/app/external/jass-nn:ro jass-inference

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.33.2

# ─────────────────────────────────────────────────────────────────────────
# Stage 1 — Basis mit pnpm via corepack
# ─────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
# Vermeidet die nervige Pnpm-Frage nach approve-builds im non-interactive Mode.
ENV CI=true

# ─────────────────────────────────────────────────────────────────────────
# Stage 2 — Dependencies (nur Manifeste kopieren → Cache-Layer maximal nutzen)
# ─────────────────────────────────────────────────────────────────────────
FROM base AS deps

# Workspace-Root-Manifeste
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./

# Pro Workspace nur die package.json (Sources kommen erst im Build-Stage)
COPY apps/inference/package.json apps/inference/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/config/package.json packages/config/package.json

# `--filter @jass/inference...` (3 Punkte = recursive deps) installiert nur
# das, was inference (transitively) braucht: engine + config + alle Externals.
# `--frozen-lockfile` garantiert Reproduzierbarkeit aus pnpm-lock.yaml.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --filter @jass/inference... --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────
# Stage 3 — Build: dist/ für engine + inference produzieren
# ─────────────────────────────────────────────────────────────────────────
FROM base AS build

# Wir kopieren die kompletten node_modules-Bäume und die Sources hinterher.
# Workspace-Symlinks innerhalb der node_modules sind durch das `node_modules`-
# Verzeichnis-Layout in einem reinen FS-COPY erhalten geblieben.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/inference/node_modules ./apps/inference/node_modules
COPY --from=deps /app/packages/engine/node_modules ./packages/engine/node_modules

# pnpm-Workspace-Setup (mit package.json + Lockfile, sonst meckert pnpm)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/inference/package.json apps/inference/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/config/package.json packages/config/package.json

# Root-tsconfig.base.json wird transitiv von `@jass/config/tsconfig/base.json`
# geerbt (mit `extends: "../../../tsconfig.base.json"`). Ohne diese Datei
# schlägt der TS-Build mit "Cannot read file '/app/tsconfig.base.json'" fehl.
COPY tsconfig.base.json ./

# Sources + tsconfig-Basis
COPY packages/config ./packages/config
COPY packages/engine/src ./packages/engine/src
COPY packages/engine/tsconfig.json packages/engine/tsconfig.build.json ./packages/engine/
COPY apps/inference/src ./apps/inference/src
COPY apps/inference/tsconfig.json ./apps/inference/

# Reihenfolge zählt: engine zuerst (inference importiert daraus).
RUN pnpm --filter @jass/engine build
RUN pnpm --filter @jass/inference build

# Vor dem Runtime-Copy: dev-deps abwerfen, damit der finale Layer mager bleibt.
# `--prod` lässt nur Production-Deps stehen.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --filter @jass/inference... --frozen-lockfile --prod

# ─────────────────────────────────────────────────────────────────────────
# Stage 4 — Runtime: nur was zum Starten gebraucht wird
# ─────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

# NN-Modelle holt sich der Container beim Start selbst (docker-entrypoint.sh →
# fetch-nn.mjs), wenn keine vorhanden sind: `unzip` zum Entpacken,
# `ca-certificates` für HTTPS zu GitHub. MODEL_DIR + scripts/ als node-eigene
# Verzeichnisse anlegen, damit ein (anfangs leeres) Volume an
# /app/external/jass-nn vom node-User beschreibbar ist.
RUN apk add --no-cache unzip ca-certificates \
    && mkdir -p /app/external/jass-nn /app/scripts \
    && chown -R node:node /app/external /app/scripts

# Kein Root: schon vom Base-Image `node`-User vorbereitet (UID 1000).
USER node

ENV NODE_ENV=production \
    INFERENCE_PORT=4000 \
    MODEL_DIR=/app/external/jass-nn

# Pnpm-Hoisting im Workspace:
#   - Zentrales `/app/node_modules` enthält den .pnpm/-Store + den Workspace-
#     Symlink für `@jass/engine` → `../packages/engine`.
#   - `apps/inference/node_modules` enthält Symlinks zu allen externen
#     Production-Deps (fastify, tfjs, pino, @jass/engine).
#   - `packages/engine/node_modules` existiert NICHT, weil die Engine keine
#     externen Runtime-Deps hat (nur @jass/config + Test-Tooling, beides dev).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/engine/dist ./packages/engine/dist
COPY --from=build --chown=node:node /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build --chown=node:node /app/apps/inference/dist ./apps/inference/dist
COPY --from=build --chown=node:node /app/apps/inference/package.json ./apps/inference/package.json
COPY --from=build --chown=node:node /app/apps/inference/node_modules ./apps/inference/node_modules

# Auto-Download der NN-Modelle: fetch-nn.mjs liest die Versions-Pins aus der
# Root-package.json#jassNn; der Entrypoint ruft es vor dem Server-Start auf.
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node scripts/fetch-nn.mjs ./scripts/fetch-nn.mjs
COPY --chown=node:node apps/inference/docker-entrypoint.sh ./docker-entrypoint.sh

EXPOSE 4000

# `MODEL_DIR` wird von server.ts als Default mit `../../external/jass-nn`
# überschrieben — wir geben ihm den absoluten Container-Pfad mit, damit das
# Volume-Mount `/app/external/jass-nn` greift.
WORKDIR /app/apps/inference

# Healthcheck: das /health-Endpoint antwortet erst, wenn das Modell geladen und
# der Warm-Up-Predict durchgelaufen ist (siehe server.ts main()).
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
