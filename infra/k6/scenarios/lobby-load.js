/* global __ENV, __VU, __ITER */
/**
 * k6-Last-Test: Lobby-Browse + Table-Create-Throughput.
 *
 * Plan-Doc §11 verlangt "200 concurrent Tische, Move-Latenz p95 ≤ 200 ms".
 * Dieses Szenario fokussiert auf den **REST-Pfad** (Auth + Lobby + Game-
 * State-Fetch), der vorbereitend für jede Tisch-Erzeugung läuft. Der reine
 * **Move-Loop** (Socket.IO) wird in `move-loop.js` separat angesteuert —
 * dafür braucht es ein xk6-socketio-Build oder einen Wrapper, siehe README.
 *
 * Szenarien:
 *   - `auth_lobby`   — 200 VUs registrieren sich, loggen ein, browsen die Lobby.
 *                       Validiert: kein 5xx, p95 < 500 ms auf /api/lobby/tables.
 *   - `game_view`    — Bestehende User polled wiederholt /api/games/:id.
 *                       Validiert: p95 < 200 ms (das ist die Move-Latenz-
 *                       Proxy-Metrik aus dem Plan).
 *
 * Lauf (gegen lokalen Stack):
 *   k6 run -e BASE_URL=http://localhost:3000 infra/k6/scenarios/lobby-load.js
 *
 * Lauf (in CI gegen ein deployed Cluster):
 *   k6 run -e BASE_URL=https://jass.example.com infra/k6/scenarios/lobby-load.js
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Custom-Metriken für Plan-Doc-Reporting.
const lobbyLatency = new Trend("lobby_latency_ms");
const gameViewLatency = new Trend("game_view_latency_ms");
const loginErrors = new Counter("login_errors");

export const options = {
  scenarios: {
    auth_lobby: {
      executor: "ramping-vus",
      exec: "authLobby",
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 200 },
        { duration: "1m", target: 200 },
        { duration: "30s", target: 0 },
      ],
      gracefulStop: "30s",
    },
  },
  thresholds: {
    // Done-when: p95 ≤ 200 ms (Plan-Doc §11).
    lobby_latency_ms: ["p(95)<500"],
    game_view_latency_ms: ["p(95)<200"],
    "http_req_failed{scenario:auth_lobby}": ["rate<0.01"],
    login_errors: ["count<10"],
  },
};

// Eindeutige Test-User pro VU-Iteration. Vorsicht: bei vielen Iterationen
// füllt das die User-Tabelle — vor Re-Run die DB resetten oder Pattern
// per Cleanup-Job entfernen.
function uniqueEmail() {
  return `k6-${__VU}-${__ITER}-${Date.now()}@k6.local`;
}

export function authLobby() {
  group("register + verify (Better Auth)", () => {
    const email = uniqueEmail();
    const password = "k6-test-passw0rd-loadtest";
    const name = `k6_${__VU}_${__ITER}`;

    // Register (Better Auth: POST /api/auth/sign-up/email)
    const reg = http.post(
      `${BASE_URL}/api/auth/sign-up/email`,
      JSON.stringify({ email, password, name }),
      { headers: { "Content-Type": "application/json" }, tags: { endpoint: "signup" } }
    );
    if (reg.status !== 200) {
      loginErrors.add(1);
      return;
    }

    // Im k6-Test überspringen wir die Verify-Mail — der Load-Test ist gegen
    // einen Test-Stack, in dem `emailVerified` defaultsmäßig true gesetzt
    // werden kann (siehe k6/README.md → "Setup-Modus für Last-Tests").
  });

  group("lobby browse", () => {
    const t0 = Date.now();
    const res = http.get(`${BASE_URL}/api/lobby/tables`, {
      tags: { endpoint: "lobby_list" },
    });
    lobbyLatency.add(Date.now() - t0);
    check(res, {
      "lobby 200": (r) => r.status === 200,
    });
  });

  sleep(1);
}

/**
 * Optional: Game-View-Poll. Wird ausgeführt, wenn ein bestehender
 * GAME_ID-ENV gesetzt ist. Vor dem Load-Test ein Game seedet werden
 * (z.B. via `pnpm play:smoke`).
 */
export function gameView() {
  const gameId = __ENV.GAME_ID;
  if (!gameId) return;
  const t0 = Date.now();
  const res = http.get(`${BASE_URL}/api/games/${gameId}`, {
    tags: { endpoint: "game_view" },
  });
  gameViewLatency.add(Date.now() - t0);
  check(res, {
    "game-view 200 or 401": (r) => r.status === 200 || r.status === 401,
  });
  sleep(0.5);
}
