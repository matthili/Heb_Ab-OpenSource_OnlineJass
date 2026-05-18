# k6-Last-Tests (M11-E)

## Done-when (Plan-Doc §11)

> 200 concurrent Tische, Move-Latenz **p95 ≤ 200 ms**.

## Voraussetzungen

```bash
# k6 lokal installieren (oder per Docker laufen lassen, s.u.)
choco install k6           # Windows mit Chocolatey
brew install k6            # macOS
sudo apt install k6        # Linux (siehe k6.io)
```

Stack hochfahren — entweder lokal (`pnpm dev:stack:nn` + `pnpm --filter @jass/api dev`)
oder gegen ein deployed Cluster (Helm).

## Lauf

### REST-Last (Lobby + Auth)

```bash
k6 run -e BASE_URL=http://localhost:3000 infra/k6/scenarios/lobby-load.js
```

Was läuft:

- `auth_lobby`: Ramping von 0 → 200 VUs über 3 Minuten. Jede VU registriert sich,
  pollt die Lobby, schläft 1 s und wiederholt.

Thresholds aus dem Skript (failen den Run):

- `lobby_latency_ms` p95 < 500 ms
- `game_view_latency_ms` p95 < 200 ms ← **Plan-Doc-Kriterium**
- HTTP-Failure-Rate < 1 %

### WebSocket-Handshake

```bash
k6 run -e BASE_URL=ws://localhost:3000 infra/k6/scenarios/ws-handshake.js
```

Validiert, dass der `/ws/` Upgrade unter 50 parallelen Verbindungen sauber tut.

### Docker-Variante (ohne lokale k6-Installation)

```bash
docker run --rm -i --network=host grafana/k6:latest \
  run -e BASE_URL=http://localhost:3000 - < infra/k6/scenarios/lobby-load.js
```

## Bekannte Einschränkungen

**Full-Game-Move-Loop**: k6's nativer WS-Client kennt das Socket.IO-Protokoll
nicht. Für die echte Move-Latenz-Messung (Client schickt `play-card`-Event,
wartet auf `state`-Broadcast) braucht es einen der folgenden Wege:

- **xk6-socketio** — k6-Custom-Build via
  `xk6 build --with github.com/grafana/xk6-...` (Projekt ist zum Stand
  2026-05 nicht offiziell maintained — eigenes Fork-Build nötig).
- **Artillery** mit `engine: socketio` — drop-in für Socket.IO,
  kann denselben Move-Loop fahren wie ein Browser-Client.
- **Node-Skript** mit `socket.io-client` + `worker_threads` — gibt volle
  Kontrolle, weniger Tooling-Magie.

Der `lobby-load.js`-Test hier deckt aber den **kritischsten REST-Pfad**
(Game-State-Fetch nach jedem Move) ab — wenn der unter 200 VUs unter
200 ms p95 bleibt, ist die Backend-Move-Latenz von der HTTP-Seite her gut.
WebSocket-Latenz wird in Folge-PRs ergänzt.

## Setup-Modus für Last-Tests

Der Last-Test überspringt die Email-Verifikation. Damit der Auth-Flow
in einem Last-Test funktioniert, muss der API-Server im "Test-Modus"
laufen:

```bash
# .env.test
SKIP_EMAIL_VERIFY=true          # auto-verify nach sign-up
RATE_LIMIT_DISABLED=true        # k6 generiert > Threshold sonst
```

(Die Flags existieren noch nicht — werden mit dem ersten echten Last-Test
ergänzt, da sie nur im Test-Stack gebraucht werden.)
