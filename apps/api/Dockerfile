# syntax=docker/dockerfile:1.7
#
# Dockerfile für @jass/api — NestJS + Fastify + Socket.IO.
#
# Multi-Stage (analog apps/inference/Dockerfile):
#   1. `deps`    — pnpm install in einem mageren Layer.
#   2. `build`   — Engine + API bauen, Prisma-Client generieren.
#   3. `runtime` — Production-Slim mit dist/, prisma engines, node_modules.
#
# Build:
#   docker build -f apps/api/Dockerfile -t jass-api .
# Run:
#   docker run --rm -p 3000:3000 \
#     -e DATABASE_URL=postgresql://... \
#     -e REDIS_URL=redis://... \
#     -e BETTER_AUTH_SECRET=... -e APP_SECRET=... \
#     jass-api

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.33.2

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
ENV CI=true

# ─────────────────────────────────────────────────────────────────────────
# Stage deps — nur Manifeste kopieren, max Cache-Hit
# ─────────────────────────────────────────────────────────────────────────
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY packages/engine/package.json packages/engine/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --filter @jass/api... --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────
# Stage build — Sources rein, build, prisma generate
# ─────────────────────────────────────────────────────────────────────────
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/engine/node_modules ./packages/engine/node_modules
# shared-types baut ebenfalls (tsc -b) → braucht seine node_modules (typescript,
# @jass/config-Symlink). config selbst hat keine.
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY packages/engine/package.json packages/engine/package.json
COPY packages/config ./packages/config
COPY packages/shared-types ./packages/shared-types

COPY packages/engine/src ./packages/engine/src
COPY packages/engine/tsconfig.json packages/engine/tsconfig.build.json ./packages/engine/
COPY apps/api/src ./apps/api/src
# Nur tsconfig.json — die API hat (anders als die Engine) keine
# tsconfig.build.json; `nest build` nutzt tsconfig.json. (Phantom-Pfad entfernt,
# der bisher JEDEN api-Image-Build scheitern ließ.)
COPY apps/api/tsconfig.json ./apps/api/

# Engine + shared-types zuerst (die API importiert aus beiden, und beide
# exportieren gebautes dist/ — kein Source-Consume wie bei @jass/ui).
RUN pnpm --filter @jass/engine build
RUN pnpm --filter @jass/shared-types build
# Prisma-Client generieren (legt sich nach node_modules/.pnpm/@prisma+client...).
RUN pnpm --filter @jass/api exec prisma generate
RUN pnpm --filter @jass/api build

# Dev-Deps abwerfen für schlanken Runtime-Layer.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --filter @jass/api... --frozen-lockfile --prod
# Prisma-Client noch einmal generieren — `--prod`-Install hat ggf. die
# generierten Dateien wieder rausgeräumt.
RUN pnpm --filter @jass/api exec prisma generate

# ─────────────────────────────────────────────────────────────────────────
# Stage runtime — schlankes Node-Image
# ─────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

# Self-Bootstrap-Entrypoint (Migrationen + Auto-Secrets) + beschreibbares
# Datenverzeichnis für persistierte Self-Host-Secrets. Als root anlegen,
# danach läuft der Container als unprivilegierter `node`-User.
COPY apps/api/docker-entrypoint.sh /usr/local/bin/jass-entrypoint.sh
RUN chmod +x /usr/local/bin/jass-entrypoint.sh \
    && mkdir -p /app/data && chown node:node /app/data

USER node

ENV NODE_ENV=production \
    API_PORT=3000

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/engine/dist ./packages/engine/dist
COPY --from=build --chown=node:node /app/packages/engine/package.json ./packages/engine/package.json
# shared-types wird zur Laufzeit aufgelöst (lobby.dto u.a. importieren Werte,
# nicht nur Typen) → dist + package.json + node_modules (zod) mit ins Image.
COPY --from=build --chown=node:node /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build --chown=node:node /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build --chown=node:node /app/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
# Prisma 7 liest die DB-URL aus prisma.config.ts (CWD = apps/api) → fürs
# `migrate deploy` im Entrypoint mit ins Image kopieren.
COPY --chown=node:node apps/api/prisma.config.ts ./apps/api/prisma.config.ts

EXPOSE 3000

WORKDIR /app/apps/api

# /api/health antwortet OK, sobald Nest hochgefahren ist + DB-Connection
# erreichbar. Wer kein health-Endpoint hat: einfacher /healthz-Endpoint
# im HealthController liegt schon vor (siehe modules/health/).
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Der Entrypoint migriert + bootstrappt (Secrets), dann startet er das CMD.
ENTRYPOINT ["/usr/local/bin/jass-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
