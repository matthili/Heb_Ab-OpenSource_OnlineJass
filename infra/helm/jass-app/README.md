# jass-app Helm-Chart

Deployt **Heb ab!** auf einen Kubernetes-Cluster: API (NestJS + Socket.IO),
Inferenz-Microservice (TF.js), Web-SPA (Vite-Build + Nginx), Landing-Site
(Astro + Nginx) und einen Ingress mit Sticky-Sessions für WebSockets.

**Nicht im Chart**: Postgres + Redis — die werden als externe Services
erwartet (Managed-DB in Produktion, oder vorhandene On-Prem-Instanzen).

## Voraussetzungen

- Kubernetes 1.27+
- Ein Ingress-Controller (Default-Annotations sind für `nginx-ingress`)
- `cert-manager` für TLS (optional)
- Container-Images in einer Registry — die Tags werden über
  `image.tag` gepinnt (CI baut typischerweise `commit-SHA`-Tags).

## Schnellstart (kind-Cluster, lokal)

```bash
# 1) kind-Cluster + nginx-Ingress
kind create cluster --name jass
kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml

# 2) Postgres + Redis via Bitnami-Helm-Charts (oder lokale Pods)
helm install pg oci://registry-1.docker.io/bitnamicharts/postgresql \
  --set auth.database=jass --set auth.username=jass --set auth.password=jass
helm install redis oci://registry-1.docker.io/bitnamicharts/redis \
  --set auth.password=jass

# 3) App
helm install jass-app infra/helm/jass-app \
  --set postgres.url='postgresql://jass:jass@pg-postgresql.default.svc:5432/jass' \
  --set redis.host='redis-master.default.svc' \
  --set redis.password='jass' \
  --set secrets.betterAuthSecret=$(openssl rand -hex 32) \
  --set secrets.appSecret=$(openssl rand -hex 32) \
  --set ingress.host='jass.local' \
  --set ingress.tls.enabled=false
```

## Production

Eigene `values-prod.yaml`:

```yaml
image:
  tag: "v1.2.3"

postgres:
  existingSecretName: "managed-pg-url" # key: url

redis:
  existingSecretName: "managed-redis" # keys: host, port, password, db, tls

secrets:
  existingSecretName: "jass-app-secrets" # keys: better-auth-secret, app-secret

ingress:
  host: "jass.example.com"
  tls:
    enabled: true
    clusterIssuer: "letsencrypt-prod"

api:
  hpa:
    minReplicas: 3
    maxReplicas: 20
inference:
  hpa:
    minReplicas: 3
    maxReplicas: 15
```

Install: `helm install jass-app . -f values-prod.yaml`.

## Sticky-Sessions / WebSocket

Der API-Server hält pro Tisch einen Redis-Lock (Single-Owner). Damit
WebSocket-Frames eines Spielers immer auf demselben Pod landen, hängt
das Ingress eine Cookie-Affinity-Annotation auf `/ws/*` (Pfad-Reihenfolge
in `templates/ingress.yaml`: `/ws` vor `/api`).

Bei einem anderen Ingress-Controller (Traefik, AWS-ALB, Caddy) müssen
die Annotations in `values.yaml#ingress.annotations` angepasst werden.

## HPA-Schwellen

Default: CPU-Target 70% für API, 75% für Inferenz. Im k6-Last-Test (M11-E
mit 200 concurrent Tischen) wird das verifiziert; bei realer Last-
Beobachtung anpassen.

## Chart-Lint

```bash
helm lint infra/helm/jass-app
helm template jass-app infra/helm/jass-app \
  --set postgres.url=test --set redis.host=test \
  --set secrets.betterAuthSecret=t --set secrets.appSecret=t
```
