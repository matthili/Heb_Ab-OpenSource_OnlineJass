# Heb ab! — Automatische Backups

Ein kleiner `backup`-Container (Basis `postgres:16-alpine`, derselbe wie die DB
→ passende `pg_dump`-Version) sichert in einer Schleife:

- **Datenbank** per `pg_dump` → `db-<ts>.sql.gz`
- **App-Daten/Secrets** (das beim Erststart erzeugte `APP_SECRET` /
  `BETTER_AUTH_SECRET` aus dem `…-data`-Volume) → `appdata-<ts>.tar.gz`
  — nur bei tunnel/selfhost; in prod kommt `APP_SECRET` aus der `.env`.

Die Dateien landen im Volume `…-backups` (gemountet auf `/backups`). Geschrieben
wird erst nach `.tmp`, dann atomar umbenannt — nie ein halbes Backup.

> ⚠️ **Off-site:** Das Backup-Volume liegt auf **demselben Host** wie die DB.
> Gegen Platten-/Host-Totalausfall hilft das nicht — die Dumps regelmäßig
> wegkopieren (rsync/scp/Cloud-Bucket). Z. B. per Host-Cron:
> `docker run --rm -v jass-tunnel-backups:/b -v /pfad/extern:/out alpine cp -a /b/. /out/`

## Stellschrauben (Env, optional)

| Variable                  | Default | Zweck                               |
| ------------------------- | ------- | ----------------------------------- |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Abstand zwischen den Läufen (1 Tag) |
| `BACKUP_RETENTION_DAYS`   | `14`    | Älteres wird gelöscht               |

Der erste Lauf passiert sofort beim Start des Containers, danach im Intervall.

## Wiederherstellen (Restore)

**Datenbank** (in eine leere/frische DB — Beispiel tunnel-Stack):

```sh
# 1. Gewünschtes Backup wählen:
docker run --rm -v jass-tunnel-backups:/b alpine ls -1 /b

# 2. Einspielen (DB muss laufen; ggf. vorher leeren/neu anlegen):
docker run --rm -i --network jass-tunnel_jass -e PGPASSWORD="$POSTGRES_PASSWORD" \
  -v jass-tunnel-backups:/b postgres:16-alpine \
  sh -c 'gunzip -c /b/db-<ts>.sql.gz | psql -h postgres -U jass -d jass'
```

**App-Daten/Secrets** (zurück ins `…-data`-Volume, API gestoppt):

```sh
docker run --rm -v jass-tunnel-data:/app/data -v jass-tunnel-backups:/b alpine \
  sh -c 'cd /app/data && tar xzf /b/appdata-<ts>.tar.gz'
```

> Netzwerk-/Volume-Namen je Stack anpassen: `jass-tunnel_*` ↔ `jass-prod_*` ↔
> `jass-selfhost_*` (Compose stellt dem Volumen-/Netz-Namen den Projektnamen voran).
