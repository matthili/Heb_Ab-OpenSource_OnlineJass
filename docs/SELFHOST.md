# Self-Hosting — „Heb ab!" zero-config auf einem Mini-PC

Ziel: **ein Befehl, kein manuelles Setup.** Frischer Rechner mit Docker → Stack
hochfahren → spielen. Secrets, Datenbank-Tabellen und Spielername-KI richten sich
selbst ein.

> **Sicherheits-Hinweis:** Dieser Modus ist für **private/LAN-Trials** gedacht.
> Er läuft über **HTTP ohne TLS** und **ohne Captcha** (`SELF_HOST=1`). Stelle
> ihn **nicht ungeschützt ins offene Internet**. Für einen öffentlichen Betrieb
> nutze `infra/docker-compose.prod.yml` (Domain + Let's-Encrypt-TLS + Turnstile).

## Voraussetzungen

- **Docker** (mit Compose v2) auf dem Mini-PC.
- **git** zum Holen des Repos (`sudo apt install -y git`) — oder eine andere Art,
  die Repo-Dateien auf die Kiste zu bringen (siehe nächster Abschnitt).

> Der eigentliche Build läuft **in Docker** — Node/pnpm musst du dafür NICHT auf
> dem Host installieren. Auf den Host gehören nur: Docker, das **Repo selbst**,
> (für die NN-Variante) die Modelldateien und cloudflared für den Tunnel.

## Repo auf den Mini-PC holen

`docker compose … --build` baut die Images **aus dem Quellcode** — die Dateien
müssen also lokal auf dem Mini-PC liegen. Am einfachsten per git:

```bash
sudo apt install -y git
git clone <DEINE-REPO-URL>      # z.B. https://github.com/<user>/<repo>.git
cd <repo-verzeichnis>
```

- **Privates Repo?** Mit Personal-Access-Token in der URL oder per SSH-Key klonen.
- **Updates später:** `git pull` (im Repo-Verzeichnis), dann `docker compose … up -d --build` erneut.
- `node_modules` werden NICHT geklont/kopiert — die entstehen im Docker-Build.
- Der erste Build kann auf einer kleinen Kiste ein paar Minuten dauern und etwas
  RAM/Disk brauchen.

Alle folgenden `docker compose …`-Befehle führst du **aus diesem Repo-Verzeichnis** aus.

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

## Öffentlich via Cloudflare Tunnel (Captcha + Selbst-Registrierung)

Sollen sich Fremde **selbst** Konten anlegen (ohne dass du jeden freischaltest)
und das Ganze über deine Domain erreichbar sein — z. B. zum Herzeigen —, nimm den
**Tunnel-Stack** `infra/docker-compose.tunnel.yml`. Er aktiviert **Turnstile-
Captcha + E-Mail-Verifikation**, lässt das TLS aber von **Cloudflare** machen
(kein Portforwarding, keine öffentliche IP nötig).

**Ziel des Ganzen:** `https://<deine-domain>` → Cloudflare (TLS) → verschlüsselter
Tunnel → `localhost:80` auf dem Mini-PC. Der letzte Hop ist rein lokal.

**1. Turnstile-Site anlegen** (Cloudflare-Dashboard → Turnstile → Add) → du
bekommst einen **Site-Key** (sichtbar) und einen **Secret-Key** (geheim).

**2. `.env`** neben dem Compose-File anlegen:

```bash
JASS_DOMAIN=jass.example.org
POSTGRES_PASSWORD=mindestens-16-zufaellige-zeichen
TURNSTILE_SECRET_KEY=<Turnstile Secret-Key>
VITE_TURNSTILE_SITE_KEY=<Turnstile Site-Key>
ADMIN_EMAIL=<deine-admin@adresse>
WATCHDOG_ALERT_EMAIL=<wohin Ausfall-Mails gehen sollen>
```

**3. NN-Modelle holen** (für die starke KI; ohne fallen „nn"-Sitze sauber auf die
Heuristik zurück). `pnpm sync:nn` braucht **Node + pnpm + gh CLI** — die hast du
auf einem nackten Mini-PC i.d.R. NICHT. Zwei Wege:

- **Auf deinem Dev-Rechner** `pnpm sync:nn` laufen lassen und den entstandenen
  Ordner `external/jass-nn/` per `scp`/`rsync` auf den Mini-PC ins Repo kopieren, **oder**
- gh CLI + Node/pnpm auf dem Mini-PC installieren und dort `pnpm sync:nn` ausführen.

Beim allerersten Trial kannst du das auch **weglassen** — dann spielt die KI mit
der (recht starken) Heuristik; das NN rüstest du später nach.

**4. Stack starten:**

```bash
docker compose -f infra/docker-compose.tunnel.yml --env-file .env up -d --build
```

Läuft danach lokal auf `http://localhost:80` (HTTP ist Absicht — das TLS macht
der Tunnel).

**5. Cloudflare Tunnel** auf dem Mini-PC (am einfachsten als **nativer Debian-
Connector**, dann zeigt der Tunnel direkt auf `localhost`):

- Dashboard: **Protect & Connect → Networking → Tunnels → Add**, Connector
  installieren (Debian-Paket).
- Im Tunnel: Reiter **Routes → Add Route → Add published application**; Ziel
  **`http://localhost:80`**, öffentlicher Name = `JASS_DOMAIN` (Subdomain +
  Domain aus dem Dropdown). Den DNS-Eintrag legt Cloudflare selbst an.

**6. SMTP eintragen** (für die Verifikations-Mails) — am besten **nach** dem
ersten Start im **Admin-Bereich → SMTP** (Passwort wird dort verschlüsselt
abgelegt; muss nirgends im Klartext liegen). Ohne SMTP kommt keine Verifikations-
Mail an → niemand kann sich selbst aktivieren.

> **Captcha:** aktiv (Turnstile). **TLS:** Cloudflare-Edge + verschlüsselter
> Tunnel — der `localhost:80`-Hop verlässt den Rechner nie. Für noch strengeren
> Zugang kannst du zusätzlich **Cloudflare Access** davorhängen (lässt nur
> eingeladene Mail-Adressen überhaupt an die Seite).
