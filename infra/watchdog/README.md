# Heb ab! — Uptime-Watchdog

Ein bewusst **eigenständiger** Mini-Dienst, der die API regelmäßig auf
`/health` pingt und den Admin **per E-Mail** alarmiert, wenn sie mehrmals in
Folge nicht antwortet — und wieder, sobald sie zurück ist.

**Warum separat?** Aus einem sterbenden Prozess heraus kann man nicht
zuverlässig mailen. Der Watchdog läuft als eigener Container (eigenes,
winziges Image, nur `nodemailer`) und **überlebt den API-Crash**.

Er ist die dritte Verteidigungslinie:

1. **Abfangen** — globaler Prozess-Wächter in der API (`main.ts`) fängt
   unbehandelte Fehler ab.
2. **Auto-Neustart** — `restart: unless-stopped` (Compose) bzw. Liveness-Probe
   (k8s) starten einen toten Container/Pod neu.
3. **Alarm** — _dieser_ Watchdog meldet, falls trotzdem mal nichts mehr geht.

## Konfiguration (Env-Variablen)

| Variable                                                                | Default                  | Zweck                                              |
| ----------------------------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| `WATCHDOG_TARGET_URL`                                                   | `http://api:3000/health` | Health-URL der API                                 |
| `WATCHDOG_INTERVAL_SECONDS`                                             | `30`                     | Ping-Intervall                                     |
| `WATCHDOG_TIMEOUT_SECONDS`                                              | `5`                      | Timeout pro Ping                                   |
| `WATCHDOG_FAILURES_BEFORE_ALERT`                                        | `3`                      | Fehler in Folge bis zum Alarm                      |
| `WATCHDOG_ALERT_EMAIL`                                                  | _(leer)_                 | **Admin-Empfänger** — leer = es wird nicht gemailt |
| `WATCHDOG_LABEL`                                                        | `Heb ab!`                | Anzeigename in der Mail                            |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | —                        | wie bei der API                                    |

## In Produktion

Läuft automatisch im `infra/docker-compose.prod.yml` (Service `watchdog`).
Die Admin-Mail-Adresse in der `.env` hinterlegen:

```
WATCHDOG_ALERT_EMAIL=admin@example.com
```

## Lokal testen (Dev-API + Mailhog)

Dev-Stack hochfahren (API auf `:3000`, Mailhog SMTP auf `:1025`, UI `:8025`),
dann den Watchdog direkt starten:

```
cd infra/watchdog
npm install
WATCHDOG_TARGET_URL=http://localhost:3000/health \
SMTP_HOST=localhost SMTP_PORT=1025 SMTP_FROM=watchdog@jass.local \
WATCHDOG_ALERT_EMAIL=admin@test.local \
WATCHDOG_FAILURES_BEFORE_ALERT=2 \
npm start
```

Stoppe dann die API (`Strg+C` im API-Terminal) → nach ein paar Pings landet
eine Alarm-Mail in Mailhog (http://localhost:8025). API wieder starten →
„wieder erreichbar"-Mail folgt.
