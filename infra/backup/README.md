# Heb ab! — Automatische Backups

Ein kleiner `backup`-Container (Basis `postgres:16-alpine`, derselbe wie die DB
→ passende `pg_dump`-Version) sichert in einer Schleife:

- **Datenbank** per `pg_dump` → `db-<ts>.sql.gz`
- **App-Daten/Secrets** (das beim Erststart erzeugte `APP_SECRET` /
  `BETTER_AUTH_SECRET` aus dem `…-data`-Volume) → `appdata-<ts>.tar.gz`
  — nur bei tunnel/selfhost; in prod kommt `APP_SECRET` aus der `.env`.

Die Dateien landen im Backup-Volume des Stacks (gemountet auf `/backups`, Namen siehe unten). Geschrieben
wird erst nach `.tmp`, dann atomar umbenannt — nie ein halbes Backup.

> ⚠️ **Off-site:** Das Backup-Volume liegt auf **demselben Host** wie die DB.
> Gegen Platten-/Host-Totalausfall hilft das nicht — die Dumps regelmäßig
> wegkopieren (rsync/scp/Cloud-Bucket). Z. B. per Host-Cron:
> `docker run --rm -v jass-tunnel_jass-tunnel-backups:/b -v /pfad/extern:/out alpine cp -a /b/. /out/`

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
docker run --rm -v jass-tunnel_jass-tunnel-backups:/b alpine ls -1 /b

# 2. Einspielen (DB muss laufen; ggf. vorher leeren/neu anlegen):
docker run --rm -i --network jass-tunnel_jass -e PGPASSWORD="$POSTGRES_PASSWORD" \
  -v jass-tunnel_jass-tunnel-backups:/b postgres:16-alpine \
  sh -c 'gunzip -c /b/db-<ts>.sql.gz | psql -h postgres -U jass -d jass'
```

**App-Daten/Secrets** (zurück ins `…-data`-Volume, API gestoppt):

```sh
docker run --rm -v jass-tunnel_jass-tunnel-data:/app/data -v jass-tunnel_jass-tunnel-backups:/b alpine \
  sh -c 'cd /app/data && tar xzf /b/appdata-<ts>.tar.gz'
```

### Volume- und Netz-Namen je Stack

Compose stellt jedem Volume- und Netz-Namen den **Projektnamen** voran. Ein
falscher Name schlägt nicht fehl — Docker legt dann still ein **neues, leeres**
Volume an. Die exakten Namen zeigt `docker volume ls`.

| Stack    | Projektname     | Backups                               | App-Daten/Secrets                  | Netz                  |
| -------- | --------------- | ------------------------------------- | ---------------------------------- | --------------------- |
| tunnel   | `jass-tunnel`   | `jass-tunnel_jass-tunnel-backups`     | `jass-tunnel_jass-tunnel-data`     | `jass-tunnel_jass`    |
| selfhost | `jass-selfhost` | `jass-selfhost_jass-selfhost-backups` | `jass-selfhost_jass-selfhost-data` | `jass-selfhost_jass`  |
| prod     | `infra`¹        | `infra_jass-backups`                  | — (Secrets aus der `.env`)         | `infra_jass-internal` |

¹ Die prod-Datei setzt keinen `name:`; Compose nimmt dann den Ordnernamen der
Datei (`infra`). Wer den Stack mit `-p <name>` startet, hat entsprechend andere
Namen.
