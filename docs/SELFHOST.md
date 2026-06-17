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
- **Ordner verschieben?** Kein Problem — git liegt im Ordner selbst (`.git/`).
  Schieb den ganzen Ordner wohin du willst und arbeite im neuen Pfad weiter,
  nichts neu einrichten. „Ordner nicht gefunden" heißt nur: du bist im alten
  Pfad → `cd` in den neuen.
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

**1. Werte vorbereiten** — gruppiert danach, _was du damit tust_:

**A) Legst DU selbst fest** (frei wählen, nichts nachschlagen):

- `JASS_DOMAIN` — die Subdomain, unter der's laufen soll (muss zu einer deiner
  Cloudflare-Domains gehören; dieselbe trägst du gleich im Tunnel ein). Z. B.
  `JASS_DOMAIN=jass.example.org`.
- `POSTGRES_PASSWORD` — irgendein neues DB-Passwort (nur intern). Einen erzeugen:
  `openssl rand -base64 24`.
- `ADMIN_EMAIL` — deine E-Mail; der damit registrierte Account wird Admin.
- `WATCHDOG_ALERT_EMAIL` — wohin Ausfall-Warnungen gehen (darf dieselbe sein).

**B) Holst du dir bei Cloudflare — Turnstile (das Captcha):**

Ziel: in Turnstile **ein Widget für deine Domain anlegen**. Erst danach zeigt
Cloudflare dir **zwei Werte** — einen **öffentlichen** (meist „Site Key") und
einen **geheimen** (meist „Secret Key"). Siehst du keine Keys, existiert noch
kein Widget → erst eines anlegen (Knopf à la „Add"/„Create"; Name + deine Domain).

> `VITE_TURNSTILE_SITE_KEY` und `TURNSTILE_SECRET_KEY` sind die Feldnamen in
> **dieser `.env`** — die suchst du NICHT bei Cloudflare. Du kopierst nur:

| Cloudflare zeigt dir …              | … das trägst du in die `.env` ein als |
| ----------------------------------- | ------------------------------------- |
| den **öffentlichen** Key (Site Key) | `VITE_TURNSTILE_SITE_KEY`             |
| den **geheimen** Key (Secret Key)   | `TURNSTILE_SECRET_KEY`                |

**C) Musst du NICHT anfassen** (erzeugt der Container beim ersten Start selbst):
`APP_SECRET`, `BETTER_AUTH_SECRET`. Die vielen anderen Felder in `.env.example`
gelten der **Dev**-Umgebung — für diesen Stack reichen A + B + D.

**D) Von deinem Mail-Anbieter — SMTP (Pflicht!):** Host, Port, Benutzer, Passwort,
Absender. Weil sich hier alle per E-Mail selbst verifizieren — **inklusive dir als
Admin** —, muss SMTP **schon beim ersten Start** laufen, sonst kann sich niemand
(auch du nicht) einloggen. Die Daten kommen vom Anbieter, bei dem deine Mail liegt
(z. B. dein bestehendes Postfach). Das Passwort steht dann im Klartext in der
`.env` auf **deinem** Rechner — das ist normal; später kannst du SMTP ins
Admin-Panel umziehen (dort verschlüsselt).

**2. `.env` anlegen — ohne Editor.** Werte oben einsetzen, dann den **ganzen
Block** auf einmal in die Konsole einfügen (schreibt die Datei in einem Rutsch,
kein nano nötig):

```bash
cat > .env <<'EOF'
JASS_DOMAIN=jass.example.org
POSTGRES_PASSWORD=dein-erzeugtes-passwort
TURNSTILE_SECRET_KEY=dein-turnstile-secret-key
VITE_TURNSTILE_SITE_KEY=dein-turnstile-site-key
ADMIN_EMAIL=du@example.com
WATCHDOG_ALERT_EMAIL=du@example.com
SMTP_HOST=mail.dein-anbieter.tld
SMTP_PORT=587
SMTP_USER=dein-postfach-login
SMTP_PASSWORD=dein-postfach-passwort
SMTP_FROM=noreply@jass.example.org
EOF
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

**6. Verifizieren + loslegen.** SMTP steckt schon in der `.env` (Schritt 1D/2),
also verschickt das System sofort Verifikations-Mails. Registriere dich mit deiner
`ADMIN_EMAIL`, klick den Link in der Mail → du bist freigeschaltet **und** Admin
(die `ADMIN_EMAIL`-Beförderung vergibt nur die Admin-Rolle, die Verifikation
machst du wie alle per Mail). Danach kannst du SMTP bei Bedarf im **Admin-Bereich →
SMTP** ändern (dort verschlüsselt). Ohne funktionierendes SMTP kommt keine
Verifikations-Mail an → niemand (auch du nicht) kann sich einloggen.

> **Captcha:** aktiv (Turnstile). **TLS:** Cloudflare-Edge + verschlüsselter
> Tunnel — der `localhost:80`-Hop verlässt den Rechner nie. Für noch strengeren
> Zugang kannst du zusätzlich **Cloudflare Access** davorhängen (lässt nur
> eingeladene Mail-Adressen überhaupt an die Seite).
