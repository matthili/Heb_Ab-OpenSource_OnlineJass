# syntax=docker/dockerfile:1.7
#
# Heb ab! — Uptime-Watchdog (eigenständig).
#
# BEWUSST entkoppelt vom Monorepo-Build (kein pnpm/turbo): der Wächter soll
# unabhängig von der App laufen + den API-Crash überleben. Daher ein winziges,
# in sich geschlossenes Image mit nur `nodemailer`.
#
# Build (aus dem Repo-Root):
#   docker build -f infra/watchdog/Dockerfile -t jass-watchdog infra/watchdog
# Lokaler Test (gegen Dev-API + Mailhog):
#   WATCHDOG_TARGET_URL=http://host.docker.internal:3000/health \
#   SMTP_HOST=host.docker.internal SMTP_PORT=1025 \
#   WATCHDOG_ALERT_EMAIL=admin@test.local \
#   docker run --rm -e ... jass-watchdog
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY watchdog.mjs ./
USER node
CMD ["node", "watchdog.mjs"]
