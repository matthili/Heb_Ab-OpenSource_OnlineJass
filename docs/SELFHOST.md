# Self-Hosting — „Heb ab!" zero-config auf einem Mini-PC

Ziel: **ein Befehl, kein manuelles Setup.** Frischer Rechner mit Docker → Stack
hochfahren → spielen. Secrets, Datenbank-Tabellen und Spielername-KI richten sich
selbst ein.

> **Sicherheits-Hinweis:** Dieser Modus ist für **private/LAN-Trials** gedacht.
> Er läuft über **HTTP ohne TLS** und **ohne Captcha** (`SELF_HOST=1`). Stelle
> ihn **nicht ungeschützt ins offene Internet**. Für einen öffentlichen Betrieb
> nutze `infra/docker-compose.prod.yml` (Domain + Let's-Encrypt-TLS + Turnstile).

## Voraussetzungen

- **Docker** (mit Compose v2) auf dem Mini-PC. Sonst nichts.

## Start (ein Befehl)

```bash
docker compose -f infra/docker-compose.selfhost.yml up -d --build
```

Beim ersten Start passiert automatisch:

1. Postgres + Redis starten.
2. Der **api-Entrypoint** generiert `APP_SECRET` + `BETTER_AUTH_SECRET`, legt sie
   auf einem Volume ab (stabil über Neustarts) und fährt **`prisma migrate deploy`**
   → die DB-Tabellen entstehen von selbst.
3. api, Web-SPA, Landing und der Caddy-Reverse-Proxy gehen online.

Danach erreichbar unter **<http://localhost>** (auf dem Mini-PC selbst).

### Zugriff aus dem LAN (andere Geräte)

Die Origin muss zur Adresse passen, über die der Browser zugreift. IP des
Mini-PCs einmalig mitgeben:

```bash
JASS_HOST=http://192.168.0.42 docker compose -f infra/docker-compose.selfhost.yml up -d --build
```

## Ersten Admin einrichten

```bash
ADMIN_EMAIL=du@example.com docker compose -f infra/docker-compose.selfhost.yml up -d
```

Der Account mit dieser Adresse wird beim Registrieren automatisch **Admin**.
(Alternativ später im Container: `node apps/api/dist/src/... admin:grant`.)

## Konten freischalten (statt E-Mail-Verifikation)

Mail ist im Self-Host-Modus **aus** (`ACCOUNT_ACTIVATION=admin`). Neue Spieler
registrieren sich, sind aber bis zur Freischaltung gesperrt. Der Admin schaltet
sie im **Admin-Bereich → Nutzer → „Freischalten"** frei. Kein SMTP nötig.

> Willst du echten Mailversand (Verifikations- + Passwort-Reset-Mails), setze im
> Admin-Panel die SMTP-Daten oder gib die `SMTP_*`-Variablen mit — siehe
> `.env.example`.

## Stärkere KI (neuronales Netz) optional nachrüsten

Standardmäßig spielen KI-Sitze mit der **Heuristik** (kein Inferenz-Container).
Für das neuronale Netz:

```bash
pnpm sync:nn          # lädt die TF.js-Modelle (braucht gh CLI)
# danach den Inferenz-Service ergänzen (eigener Container, MODEL_DIR auf
# external/jass-nn gemountet) — siehe infra/docker-compose.prod.yml als Vorlage.
```

Ohne NN fallen „nn"-Sitze automatisch sauber auf die Heuristik zurück; der
Engine-Status-Tooltip am KI-Sitz zeigt das an.

## Verwalten

```bash
# Logs
docker compose -f infra/docker-compose.selfhost.yml logs -f api
# Stoppen (Daten bleiben in den Volumes)
docker compose -f infra/docker-compose.selfhost.yml down
# Alles inkl. Daten löschen
docker compose -f infra/docker-compose.selfhost.yml down -v
```
