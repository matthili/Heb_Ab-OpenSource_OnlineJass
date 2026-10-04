# syntax=docker/dockerfile:1.7
#
# Dockerfile für @jass/landing — Astro statisch + Nginx.
#
# Identische Struktur wie apps/web/Dockerfile, nur einfacher (kein
# Service-Worker, keine PWA-Assets).

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=12.9.1

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
# pnpm 12 ist ein natives Programm: `npm install -g` holt das passende Binary
# (für Alpine: linux-x64-musl) über die optionalen Plattform-Pakete. Das
# Install-Skript, das es verlinkt, führt npm 11 nur mit --allow-scripts aus
# (sonst läuft pnpm über einen Node-Umweg).
RUN npm install -g --allow-scripts=pnpm pnpm@${PNPM_VERSION} && pnpm --version
WORKDIR /app
ENV CI=true

FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/landing/package.json apps/landing/package.json
COPY packages/config/package.json packages/config/package.json

# --store-dir = der Cache-Mount: so bleibt der pnpm-Store sicher außerhalb
# des Images (pnpm 12 legt ihn sonst unter Umständen nach node_modules/.pnpm-store).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --store-dir /root/.local/share/pnpm/store --filter @jass/landing... --frozen-lockfile

FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/landing/node_modules ./apps/landing/node_modules

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/landing/package.json apps/landing/package.json
COPY packages/config ./packages/config

COPY apps/landing ./apps/landing

# Karten-Assets + Sync-Skript fürs `prebuild` (sync-landing-cards.mjs kopiert
# assets/cards → public/cards). Ohne sie scheitert der prebuild-Hook von
# `astro build` mit „Cannot find module …/scripts/sync-landing-cards.mjs".
COPY scripts/sync-landing-cards.mjs ./scripts/sync-landing-cards.mjs
COPY assets/cards ./assets/cards

RUN pnpm --filter @jass/landing build

# ─────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

RUN <<'EOF' cat > /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  # Astro generiert pretty URLs (/about → /about/index.html).
  location / {
    try_files $uri $uri/index.html /index.html;
  }
}
EOF

COPY --from=build /app/apps/landing/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1
