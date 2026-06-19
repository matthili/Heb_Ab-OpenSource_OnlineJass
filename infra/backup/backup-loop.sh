#!/bin/sh
# Heb ab! — Backup-Schleife (läuft im `backup`-Container, Basis postgres:16-alpine).
#
# Pro Durchlauf:
#   1. `pg_dump` der Datenbank → gzip → /backups/db-<ts>.sql.gz
#   2. (falls App-Daten-Volume gemountet) Tarball der Secrets → appdata-<ts>.tar.gz
#   3. Rotation: alles älter als BACKUP_RETENTION_DAYS löschen.
# Dann `sleep BACKUP_INTERVAL_SECONDS` und von vorn.
#
# Geschrieben wird erst in `.tmp` und dann atomar umbenannt — so liegt nie ein
# halbes Backup herum, falls der Lauf mittendrin abbricht.
#
# WICHTIG: Das /backups-Volume liegt auf DEMSELBEN Host wie die DB. Gegen einen
# Festplatten-/Host-Totalausfall hilft das NICHT — die Dumps regelmäßig
# wegkopieren (rsync/scp/Cloud). Siehe infra/backup/README.md.
set -eu

: "${PGHOST:=postgres}"
: "${PGUSER:=jass}"
: "${PGDATABASE:=jass}"
: "${BACKUP_DIR:=/backups}"
: "${APPDATA_DIR:=/appdata}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"
: "${BACKUP_RETENTION_DAYS:=14}"

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

mkdir -p "$BACKUP_DIR"
log "Start — Intervall ${BACKUP_INTERVAL_SECONDS}s, Aufbewahrung ${BACKUP_RETENTION_DAYS} Tage, Ziel $BACKUP_DIR"

run_backup() {
  ts=$(date -u +%Y%m%d-%H%M%SZ)

  db_out="$BACKUP_DIR/db-${ts}.sql.gz"
  if pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" | gzip -9 >"${db_out}.tmp"; then
    mv "${db_out}.tmp" "$db_out"
    log "DB-Backup ok: $(basename "$db_out") ($(wc -c <"$db_out") Bytes)"
  else
    log "FEHLER: pg_dump fehlgeschlagen ($ts)"
    rm -f "${db_out}.tmp"
  fi

  # App-Daten (entrypoint-generierte Secrets) — nur wenn das Volume gemountet
  # und nicht leer ist (prod liefert APP_SECRET per Env → kein Volume).
  if [ -d "$APPDATA_DIR" ] && [ -n "$(ls -A "$APPDATA_DIR" 2>/dev/null || true)" ]; then
    appdata_out="$BACKUP_DIR/appdata-${ts}.tar.gz"
    if tar czf "${appdata_out}.tmp" -C "$APPDATA_DIR" .; then
      mv "${appdata_out}.tmp" "$appdata_out"
      log "App-Daten-Backup ok: $(basename "$appdata_out")"
    else
      log "FEHLER: App-Daten-Tar fehlgeschlagen ($ts)"
      rm -f "${appdata_out}.tmp"
    fi
  fi

  # Rotation (mtime-basiert; bei Tages-Intervall bleiben ~RETENTION_DAYS Stück).
  find "$BACKUP_DIR" -name 'db-*.sql.gz' -type f -mtime +"$BACKUP_RETENTION_DAYS" -delete 2>/dev/null || true
  find "$BACKUP_DIR" -name 'appdata-*.tar.gz' -type f -mtime +"$BACKUP_RETENTION_DAYS" -delete 2>/dev/null || true
}

while true; do
  run_backup || log "Backup-Durchlauf mit Fehler beendet (Loop läuft weiter)"
  sleep "$BACKUP_INTERVAL_SECONDS"
done
