# jass-app Helm-Chart

Deployt **Heb ab!** auf einen Kubernetes-Cluster: API (NestJS + Socket.IO),
Inferenz-Microservice (TF.js), Web-SPA (Vite-Build + Nginx), Landing-Site
(Astro + Nginx) und die Ingress-Regeln.

**Nicht im Chart**: Postgres + Redis — die werden als externe Services
erwartet (Managed-DB in Produktion, oder vorhandene On-Prem-Instanzen).

> **Stand 2026-10-04:** Geprüft mit `helm lint --strict` und `helm template`
> (Helm 4.3, mehrere Wert-Varianten); die nginx-Sicherheitseinstellungen per
> Docker nachgestellt. In einem echten Cluster ist der Chart nicht getestet. Die Ingress-Annotations sind für **ingress-nginx**
> geschrieben; das Kubernetes-Projekt hat ingress-nginx am 24.03.2026
> eingestellt (keine Sicherheitsupdates mehr) und empfiehlt die Gateway API.

## Voraussetzungen

- Kubernetes 1.27+
- Ein Ingress-Controller. Die Annotations (Cookie-Affinity, `/app`-Rewrite)
  sind für ingress-nginx; bei anderen Controllern anpassen (siehe unten).
- `cert-manager` für TLS (optional)
- **Eigene Container-Images** in einer Registry — das Repo veröffentlicht
  keine. Bauen aus dem Repo-Root mit `docker build -f apps/<app>/Dockerfile .`
  für `api`, `inference`, `web`, `landing`. Das **Web-Image** braucht schon beim
  Build den öffentlichen Turnstile-Site-Key:
  `--build-arg VITE_TURNSTILE_SITE_KEY=<site-key>`.
- **Turnstile-Secret** (Cloudflare) — ohne bricht die API in production den
  Start ab.
- Ausgehender Zugriff der Inferenz-Pods auf GitHub: Sie laden die NN-Modelle
  bei jedem Start selbst (siehe unten).

## Schnellstart (kind-Cluster, lokal)

Den kind-Cluster mit Ingress-Portfreigabe anlegen und ingress-nginx
installieren, wie in der kind-Doku unter „Ingress" beschrieben. Dann:

```bash
# 1) Images bauen und in den kind-Cluster laden (Präfix "local" = image.registry).
#    Die Site-Key-Testwerte von Cloudflare bestehen immer (nur zum Testen).
for app in api inference landing; do
  docker build -f apps/$app/Dockerfile -t local/jass-$app:dev .
done
docker build -f apps/web/Dockerfile -t local/jass-web:dev \
  --build-arg VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA .
for app in api inference web landing; do kind load docker-image local/jass-$app:dev; done

# 2) Postgres + Redis als einfache Pods (offizielle Images, nur zum Testen)
kubectl run pg --image=postgres:16-alpine --port=5432 \
  --env=POSTGRES_USER=jass --env=POSTGRES_PASSWORD=jass --env=POSTGRES_DB=jass
kubectl expose pod pg --port=5432
kubectl run redis --image=redis:7-alpine --port=6379
kubectl expose pod redis --port=6379

# 3) App
helm install jass-app infra/helm/jass-app \
  --set image.registry=local --set image.tag=dev \
  --set postgres.url='postgresql://jass:jass@pg.default.svc:5432/jass' \
  --set redis.host='redis.default.svc' \
  --set secrets.betterAuthSecret=$(openssl rand -hex 32) \
  --set secrets.appSecret=$(openssl rand -hex 32) \
  --set secrets.turnstileSecretKey=1x0000000000000000000000000000000AA \
  --set api.env.adminEmail=du@example.com \
  --set ingress.host='jass.local' \
  --set ingress.tls.enabled=false
```

Ohne TLS laufen die öffentlichen URLs der API automatisch über `http://`.
SMTP für Verifikations-Mails trägst du danach im Admin-Bereich ein; das Konto
aus `api.env.adminEmail` wird Admin.

## Production

Eigene `values-prod.yaml`:

```yaml
image:
  registry: "ghcr.io/<dein-account>"
  tag: "<commit-sha>"

postgres:
  existingSecretName: "managed-pg-url" # key: url

redis:
  existingSecretName: "managed-redis" # key: url (z. B. rediss://:pass@host:6380/0)

secrets:
  existingSecretName: "jass-app-secrets" # keys: better-auth-secret, app-secret, turnstile-secret-key

api:
  env:
    adminEmail: "admin@example.com"

ingress:
  host: "jass.example.com"
  tls:
    enabled: true
    clusterIssuer: "letsencrypt-prod"

inference:
  hpa:
    minReplicas: 3
    maxReplicas: 15
```

Install: `helm install jass-app infra/helm/jass-app -f values-prod.yaml`.

## Eine API-Replik

Der Chart startet die API mit **einer** Replik, ohne HPA und mit
`strategy: Recreate` (auch beim Update nie zwei API-Pods zugleich). Grund: Der
Spiel-Lock (`GameLockService`) und die Timer der Disconnect-Abstimmung liegen
im **Speicher** des API-Prozesses, nicht in Redis. Bei mehreren Repliken
könnten Züge am selben Tisch auf verschiedenen Pods landen, ohne dass der Lock
sie gegeneinander schützt — die Cookie-Affinity bindet einen _Client_ an einen
Pod, nicht einen _Tisch_. Erst mit einem verteilten Lock (z. B. Redis
`SET … NX EX`, so vermerkt in `game-lock.service.ts`) `api.replicas` bzw.
`api.hpa` hochdrehen.

Die Inferenz ist zustandslos und skaliert per HPA (Default 2–8 Pods, CPU-Ziel
75 %). Web und Landing sind statisch (je 2 Pods).

## NN-Modelle

Die Modelle stecken nicht im Inferenz-Image. Beim Start lädt der Container per
`scripts/fetch-nn.mjs` die in `package.json#jassNn` gepinnten Releases aus den
öffentlichen JCN9000-Releases auf GitHub (ohne Token) in ein `emptyDir` — also
bei **jedem** Pod-Start neu. Welche Spielarten geladen werden, steuert
`inference.gameTypes` (Default alle drei). Die `startupProbe` gibt dafür bis zu
5 Minuten Zeit. Klappt der Download nicht, spielen KI-Sitze mit der Heuristik.

## Ingress-Regeln

| Pfad       | Ziel                                                             |
| ---------- | ---------------------------------------------------------------- |
| `/ws`      | API (Socket.IO), Cookie-Affinity `jass-affinity`                 |
| `/api`     | API                                                              |
| `/healthz` | API (Readiness inkl. Postgres)                                   |
| `/app`     | Web-SPA — eigenes Ingress-Objekt, schneidet das Präfix `/app` ab |
| `/`        | Landing                                                          |

Das Web-Image liefert am Root aus (hinter Caddy schneidet `handle_path /app/*`
das Präfix ab). Im Cluster übernimmt das das zweite Ingress-Objekt
`<release>-web` mit `rewrite-target: /$2`.

Bei einem anderen Controller (Traefik, AWS-ALB, Gateway API) müssen die
Affinity-Annotations und der `/app`-Rewrite entsprechend umgesetzt werden;
eigene Annotations gehen über `values.yaml#ingress.annotations`.

## Sicherheitskontext

Alle Pods laufen als UID 1000 ohne Capabilities (`podSecurityContext`,
`securityContext`). Web und Landing sind Stock-nginx: Dafür hängt der Chart
`emptyDir`s für `/var/cache/nginx` und `/run` ein und erlaubt per Pod-Sysctl
`net.ipv4.ip_unprivileged_port_start=0` den Port 80 ohne root (sicherer Sysctl
seit Kubernetes 1.22). Ohne diese Pfade bricht nginx als Nicht-root beim Start
ab (`mkdir /var/cache/nginx/client_temp: Permission denied`, per Docker
nachgestellt).

## Chart-Lint

```bash
helm lint infra/helm/jass-app \
  --set image.tag=t --set postgres.url=test --set redis.host=test \
  --set secrets.betterAuthSecret=t --set secrets.appSecret=t \
  --set secrets.turnstileSecretKey=t
helm template jass-app infra/helm/jass-app \
  --set image.tag=t --set postgres.url=test --set redis.host=test \
  --set secrets.betterAuthSecret=t --set secrets.appSecret=t \
  --set secrets.turnstileSecretKey=t
```
