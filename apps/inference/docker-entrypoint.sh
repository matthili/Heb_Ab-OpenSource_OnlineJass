#!/bin/sh
# Self-Bootstrap des Inferenz-Containers.
#
# Fehlt das NN-Modell (kein gemountetes, kein bereits geladenes), holt es sich
# der Container beim Start selbst aus den ÖFFENTLICHEN JCN9000-Releases
# (scripts/fetch-nn.mjs, gh-frei via GitHub-API). Best-effort: schlägt der
# Download fehl (kein Netz o.ä.), startet der Server trotzdem — die API fällt
# dann ohnehin auf die Heuristik zurück, das Spiel bleibt spielbar.
#
# Idempotent: bereits vorhandene, versions-passende Modelle werden übersprungen
# (MANIFEST-Check in fetch-nn.mjs) → bei einem Restart kein erneuter Download.
set -e

echo "[entrypoint] Prüfe/lade NN-Modelle nach ${MODEL_DIR:-/app/external/jass-nn} ..."
node /app/scripts/fetch-nn.mjs || echo "[entrypoint] NN-Auto-Download fehlgeschlagen — Server startet trotzdem (Heuristik-Fallback)."

exec "$@"
