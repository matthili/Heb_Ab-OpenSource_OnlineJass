# Self-Hosting — „Heb ab!" zero-config auf einem Mini-PC

Ziel: **ein Befehl, kein manuelles Setup.** Frischer Rechner mit Docker → Stack
hochfahren → spielen. Secrets, Datenbank-Tabellen und Spielername-KI richten sich
selbst ein.

> **Sicherheits-Hinweis:** Dieser Modus ist für **private/LAN-Trials** gedacht.
> Er läuft über **HTTP ohne TLS** und **ohne Captcha** (`SELF_HOST=1`). Stelle
> ihn **nicht ungeschützt ins offene Internet**. Für einen öffentlichen Betrieb
> nutze den **Tunnel-Stack** (unten: Cloudflare Tunnel + Turnstile) oder
> `infra/docker-compose.prod.yml` (eigene Domain + Let's-Encrypt-TLS + Turnstile).

## Voraussetzungen

- **Docker** (mit Compose v2) auf dem Mini-PC.
- **git** zum Holen des Repos (`sudo apt install -y git`) — oder eine andere Art,
  die Repo-Dateien auf die Kiste zu bringen (siehe nächster Abschnitt).

> Der eigentliche Build läuft **in Docker** — Node/pnpm musst du dafür NICHT auf
> dem Host installieren. Auf den Host gehören nur: Docker, das **Repo selbst** und
> (für den Tunnel) cloudflared. Die NN-Modelle holt sich der Inferenz-Container des
> Tunnel-Stacks selbst.

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

Der Account mit dieser Adresse wird beim Registrieren automatisch **Admin** —
gibt es ihn schon, beim nächsten Start der API. Weitere Admins vergibst du danach
im **Admin-Bereich → Users** über die Rolle.

## Konten freischalten (statt E-Mail-Verifikation)

Mail ist im Self-Host-Modus **aus** (`ACCOUNT_ACTIVATION=admin`). Neue Spieler
registrieren sich, sind aber bis zur Freischaltung gesperrt. Der Admin schaltet
sie im **Admin-Bereich → Users → „Freischalten"** frei. Kein SMTP nötig.

> Willst du echten Mailversand (Verifikations- + Passwort-Reset-Mails), setze im
> Admin-Panel die SMTP-Daten oder gib die `SMTP_*`-Variablen mit — siehe
> `.env.example`.

## Stärkere KI (neuronales Netz) optional nachrüsten

Standardmäßig spielen KI-Sitze mit der **Heuristik** — der LAN-Stack hat keinen
Inferenz-Container. Für das neuronale Netz zwei Wege:

- **Einfach:** gleich den Tunnel-Stack nehmen (unten). Sein Inferenz-Container lädt
  die Modelle beim ersten Start selbst.
- **Im LAN-Stack nachrüsten:** den Dienst `inference` samt Volume aus
  `infra/docker-compose.tunnel.yml` übernehmen und beim Dienst `api`
  `INFERENCE_URL: http://inference:4000` ergänzen. Auch dann holt sich der Container
  die Modelle selbst (öffentliche JCN9000-Releases, kein `gh`, kein Token).

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
- `POSTGRES_PASSWORD` — irgendein neues DB-Passwort (nur intern). Erzeugen mit
  `openssl rand -hex 24` — **hex, weil URL-sicher**: das Passwort landet in der
  DB-URL (`postgresql://jass:…@postgres:5432/…`), und Zeichen wie `/` `+` `=`
  (aus `base64`) zerschießen sie („invalid port number").
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

**2. `.env` anlegen.** Am einfachsten die mitgelieferte Vorlage kopieren und die
Werte eintragen: `cp .env.tunnel.example .env`. Oder ohne Editor den **ganzen
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

**3. NN-Modelle:** nichts zu tun. Der Inferenz-Container lädt beim ersten Start die
in `package.json#jassNn` gepinnten Modelle aus den öffentlichen JCN9000-Releases
(`scripts/fetch-nn.mjs`, ohne `gh` und ohne Token) und legt sie im Volume
`jass-tunnel_jass-tunnel-nn` ab; bei Neustarts bleiben sie liegen. Klappt der
Download nicht (z. B. kein Internet), spielen „nn"-Sitze mit der Heuristik.

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
SMTP** ändern (dort verschlüsselt) und mit **„Testmail senden"** sofort prüfen, ob
der Versand klappt — bei einem Fehler zeigt das Panel die Meldung des Mailservers.
Ohne funktionierendes SMTP kommt keine Verifikations-Mail an → niemand (auch du
nicht) kann sich einloggen.

**Betrieb:** Backups (Datenbank + Secrets, täglich, 14 Tage), Autoheal,
Log-Rotation und der Ausfall-Watchdog laufen im Stack automatisch mit. Restore und
Off-site-Kopie: [`infra/backup/README.md`](../infra/backup/README.md); die
Alarm-Mails des Watchdogs gehen an `WATCHDOG_ALERT_EMAIL`.

> **Captcha:** aktiv (Turnstile). **TLS:** Cloudflare-Edge + verschlüsselter
> Tunnel — der `localhost:80`-Hop verlässt den Rechner nie. Für noch strengeren
> Zugang kannst du zusätzlich **Cloudflare Access** davorhängen (lässt nur
> eingeladene Mail-Adressen überhaupt an die Seite).

## Fehlersuche

### Captcha zeigt „Erfolg!", die Registrierung meldet trotzdem „Captcha-Validierung fehlgeschlagen" — und Mails kommen nicht an

Das grüne „Erfolg!" heißt nur, dass der **Browser** die Aufgabe gelöst hat. Die
eigentliche Prüfung macht danach die **API** bei Cloudflare, und auch der
Mail-Versand braucht eine Verbindung nach draußen. Steht im **Admin-Bereich →
Audit-Log** bei `security.captcha.reject` der Fehler `network-error` (und unter
**System-Log** ein `TimeoutError` vom `TurnstileService`), kommt der
api-Container nicht ins Internet.

Häufigste Ursache: Der Container hat **keinen DNS-Server**. Prüfen:

```bash
docker exec jass-tunnel-api-1 cat /etc/resolv.conf
```

Steht dort `# NO EXTERNAL NAMESERVERS DEFINED`, hat Docker den Container
gestartet, als in der `/etc/resolv.conf` des Rechners noch kein `nameserver`
stand — typisch beim Hochfahren, wenn der DHCP-Client die DNS-Server erst
einträgt, nachdem Docker die Container schon gestartet hat. Ein Neustart des
Rechners hilft dann nicht, das passiert beim nächsten Hochfahren wieder.

**Dauerhafte Abhilfe:** Docker die DNS-Server fest vorgeben. Die beiden Adressen
unten sind Platzhalter — trag die DNS-Server deines Netzes ein (z. B. Pi-hole
und Router; `cat /etc/resolv.conf` auf dem Rechner zeigt, welche er nutzt).
Gibt es `/etc/docker/daemon.json` schon (`sudo cat /etc/docker/daemon.json`),
den `"dns"`-Eintrag dort ergänzen statt die Datei zu überschreiben.

```bash
echo '{ "dns": ["192.168.1.2", "192.168.1.1"] }' | sudo tee /etc/docker/daemon.json
```

```bash
sudo systemctl restart docker
```

```bash
docker compose -f infra/docker-compose.tunnel.yml --env-file .env up -d --force-recreate
```

Danach zeigt `docker exec jass-tunnel-api-1 cat /etc/resolv.conf` statt der
Warnung eine Zeile `# ExtServers: [...]` mit deinen Adressen. Die Daten in den
Volumes bleiben bei alldem unberührt. Rückgängig:
`sudo rm /etc/docker/daemon.json && sudo systemctl restart docker`.
