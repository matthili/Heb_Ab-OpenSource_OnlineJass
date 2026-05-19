# syntax=docker/dockerfile:1.7
#
# Dockerfile für @jass/web — Vite-React-SPA + PWA.
#
# Multi-Stage:
#   1. `deps`    — pnpm install
#   2. `build`   — Vite-Production-Build (dist/ als static assets)
#   3. `runtime` — Nginx serviert das Verzeichnis. SPA-Fallback auf
#                   index.html, weil TanStack-Router client-routet.
#
# Build:
#   docker build -f apps/web/Dockerfile -t jass-web .
# Run:
#   docker run --rm -p 8080:80 jass-web
#
# **Env zum Build-Zeitpunkt**: Vite ersetzt `import.meta.env.VITE_*` beim
# Bundle-Schritt — d.h. zur Build-Zeit, nicht zur Runtime. Wer also einen
# anderen Site-Key (Turnstile) für Prod-Build will, muss `--build-arg
# VITE_TURNSTILE_SITE_KEY=...` setzen.

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.33.2

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
ENV CI=true

# ─────────────────────────────────────────────────────────────────────────
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --filter @jass/web... --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/config ./packages/config
COPY packages/shared-types ./packages/shared-types
COPY packages/ui ./packages/ui

COPY packages/engine/src ./packages/engine/src
COPY packages/engine/tsconfig.json packages/engine/tsconfig.build.json ./packages/engine/

COPY apps/web ./apps/web

# Engine zuerst — Web importiert daraus.
RUN pnpm --filter @jass/engine build

# Build-Zeit-Env durchreichen, falls vom `docker build --build-arg` gesetzt.
ARG VITE_TURNSTILE_SITE_KEY=""
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}

RUN pnpm --filter @jass/web build

# ─────────────────────────────────────────────────────────────────────────
# Stage runtime — nginx-alpine als Static-Server
# ─────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# SPA-Fallback + Gzip + Cache-Headers. PWA-Service-Worker (sw.js) NIE
# cachen — sonst sieht der Browser nie ein Update.
RUN <<'EOF' cat > /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # Asset-Caching: gehashte Dateinamen → immutable lange Cache.
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  # Service-Worker + manifest dürfen nie gecacht werden.
  location = /sw.js              { add_header Cache-Control "no-cache"; }
  location = /registerSW.js      { add_header Cache-Control "no-cache"; }
  location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }

  # SPA-Fallback: jede unbekannte Route landet auf index.html — TanStack
  # Router macht client-side den Rest.
  location / {
    try_files $uri $uri/ /index.html;
  }
}
EOF

COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1
