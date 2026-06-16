#!/bin/sh
# Self-Bootstrap-Entrypoint der @jass/api.
#
# Macht einen frischen Container „zero-touch": (1) Secrets automatisch
# generieren + persistieren (falls nicht via Env vorgegeben), (2) DB-Migrationen
# anwenden, (3) die App starten. Funktioniert für echten Prod-Deploy UND für den
# SELF_HOST-Trial — beide brauchen migrierte Tabellen + gültige Secrets.
set -eu

DATA_DIR="${SELFHOST_DATA_DIR:-/app/data}"
SECRETS_FILE="$DATA_DIR/secrets.env"

# ── 1. Secrets: generieren + persistieren, falls nicht via Env gesetzt ──
# Persistenz ist wichtig: ein neues APP_SECRET pro Restart würde alle Sessions
# ungültig machen + verschlüsselte Werte (z.B. SMTP-Passwort) unlesbar machen.
if [ -z "${APP_SECRET:-}" ] || [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  if [ -f "$SECRETS_FILE" ]; then
    # shellcheck disable=SC1090
    . "$SECRETS_FILE"
    export APP_SECRET BETTER_AUTH_SECRET
    echo "[entrypoint] Secrets aus $SECRETS_FILE geladen."
  else
    mkdir -p "$DATA_DIR"
    : "${APP_SECRET:=$(node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("base64url"))')}"
    : "${BETTER_AUTH_SECRET:=$(node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("base64url"))')}"
    export APP_SECRET BETTER_AUTH_SECRET
    umask 077
    printf 'APP_SECRET=%s\nBETTER_AUTH_SECRET=%s\n' "$APP_SECRET" "$BETTER_AUTH_SECRET" >"$SECRETS_FILE"
    echo "[entrypoint] Neue Secrets erzeugt + in $SECRETS_FILE persistiert (stabil über Restarts)."
  fi
fi

# ── 2. DB-Migrationen anwenden (Retry, bis Postgres erreichbar ist) ──
echo "[entrypoint] Wende DB-Migrationen an (prisma migrate deploy) ..."
n=0
until node_modules/.bin/prisma migrate deploy; do
  n=$((n + 1))
  if [ "$n" -ge 30 ]; then
    echo "[entrypoint] Migration nach 30 Versuchen fehlgeschlagen — Abbruch." >&2
    exit 1
  fi
  echo "[entrypoint] DB noch nicht bereit (Versuch $n/30) — warte 2s ..."
  sleep 2
done
echo "[entrypoint] Migrationen aktuell."

# ── 3. App starten (das ist das CMD aus dem Dockerfile) ──
exec "$@"
