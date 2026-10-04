# k6-Last-Tests (M11-E)

## Done-when (Plan-Doc §11)

> 200 concurrent Tische, Move-Latenz **p95 ≤ 200 ms**.

## Stand (2026-10-04)

Gemessen ist noch nichts. Gegen den aktuellen Stack laufen die Szenarien
**nicht ohne Anpassung**:

- `/api/lobby/*` verlangt eine Sitzung (`SessionGuard`); `lobby-load.js` meldet
  sich aber nicht an.
- Die Registrierung verlangt ein Captcha-Token (Turnstile) — ohne nur mit
  `DISABLE_TURNSTILE=1` an der API.
- Neue Konten müssen ihre E-Mail bestätigen bzw. vom Admin freigeschaltet werden,
  bevor sie sich anmelden können. Einen Schalter zum Überspringen gibt es nicht.
- Zustandsändernde Requests ohne passenden `Origin`-Header lehnt die API in
  Production mit 403 ab (im Dev-Modus erlaubt); k6 muss ihn dann mitschicken.
- Das im Skriptkopf von `lobby-load.js` erwähnte `move-loop.js` existiert nicht.

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

Vorhandene Schalter an der API — **nur für Test-Stacks**, nie in Produktion:

```bash
DISABLE_AUTH_RATE_LIMIT=1   # Better-Auth-Rate-Limit aus (sonst 429 bei vielen Registrierungen)
DISABLE_TURNSTILE=1         # Captcha-Prüfung aus
```

Einen Schalter, der die E-Mail-Verifikation überspringt, gibt es nicht
(`ACCOUNT_ACTIVATION` kennt nur `email` und `admin`). Für einen echten Lauf
braucht es also vorab verifizierte Test-Konten (oder einen solchen Schalter) und
ein Login im Szenario.
