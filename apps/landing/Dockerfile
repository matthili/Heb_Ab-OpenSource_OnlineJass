# syntax=docker/dockerfile:1.7
#
# Dockerfile für @jass/landing — Astro statisch + Nginx.
#
# Identische Struktur wie apps/web/Dockerfile, nur einfacher (kein
# Service-Worker, keine PWA-Assets).

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.33.2

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
ENV CI=true

FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/landing/package.json apps/landing/package.json
COPY packages/config/package.json packages/config/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --filter @jass/landing... --frozen-lockfile

FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/landing/node_modules ./apps/landing/node_modules

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/landing/package.json apps/landing/package.json
COPY packages/config ./packages/config

COPY apps/landing ./apps/landing

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
