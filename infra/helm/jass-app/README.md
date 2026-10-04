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

Damit WebSocket-Frames eines Clients immer auf demselben Pod landen, hängt
das Ingress eine Cookie-Affinity-Annotation an (`nginx.ingress.kubernetes.io/affinity: cookie`;
Pfad-Reihenfolge in `templates/ingress.yaml`: `/ws` vor `/api`).

> ⚠️ **Mehrere API-Repliken sind derzeit nicht abgesichert.** Der Spiel-Lock
> (`GameLockService`) und die Timer der Disconnect-Abstimmung liegen im
> **Speicher** des API-Prozesses, nicht in Redis. Die Cookie-Affinity bindet einen
> _Client_ an einen Pod, nicht einen _Tisch_: Spielen zwei Menschen am selben Tisch
> über verschiedene Pods, schützt der Lock ihre Züge nicht gegeneinander. Bis es
> einen verteilten Lock gibt (z. B. Redis `SET … NX EX`, so vermerkt in
> `game-lock.service.ts`), die API mit **einer** Replik betreiben:
> `--set api.replicas=1 --set api.hpa.enabled=false`. Der Inferenz-Dienst ist
> zustandslos und darf skalieren. (Die Chart-Defaults stehen noch auf 2–10
> API-Repliken.)

Bei einem anderen Ingress-Controller (Traefik, AWS-ALB, Caddy) müssen
die Annotations in `values.yaml#ingress.annotations` angepasst werden.

## HPA-Schwellen

Default: CPU-Target 70% für API, 75% für Inferenz. Gemessen ist das noch nicht:
der k6-Lasttest (`infra/k6`) braucht vorher Anpassungen (siehe dessen README).
Bei realer Last-Beobachtung anpassen — und für die API den Hinweis oben zu
mehreren Repliken beachten.

## Chart-Lint

```bash
helm lint infra/helm/jass-app
helm template jass-app infra/helm/jass-app \
  --set postgres.url=test --set redis.host=test \
  --set secrets.betterAuthSecret=t --set secrets.appSecret=t
```
