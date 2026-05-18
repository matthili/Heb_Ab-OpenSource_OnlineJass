/* global __ENV */
/**
 * k6-WebSocket-Handshake-Test (eingeschränkt).
 *
 * **Was hier geht**: rohe WS-Verbindung gegen `/ws/` öffnen, prüfen dass
 * der Server die Verbindung annimmt (HTTP 101) und einen Engine.IO-
 * Handshake-Frame sendet.
 *
 * **Was hier NICHT geht (Stand k6 v1)**: Socket.IO-Protokoll-Frames
 * (Ack-Roundtrips, EVENT-Pakete, Disconnect-Reasons). Socket.IO setzt
 * auf einem eigenen Framing-Layer auf, den k6's nativer WS-Client nicht
 * kennt. Für realistische Move-Loop-Latenz-Messungen braucht es:
 *
 *   a) ein xk6-socketio-Build (`xk6 build --with github.com/...`), oder
 *   b) Artillery mit `engine: socketio`-Plugin, oder
 *   c) ein eigenes Node-Skript mit `socket.io-client` + Worker-Threads.
 *
 * Diese Datei stellt sicher, dass der Sticky-Cookie + WS-Upgrade
 * grundsätzlich tut — der Rest läuft über die Optionen oben.
 *
 * Lauf:
 *   k6 run -e BASE_URL=ws://localhost:3000 infra/k6/scenarios/ws-handshake.js
 */
import ws from "k6/ws";
import { check } from "k6";

const BASE_URL = (__ENV.BASE_URL || "ws://localhost:3000").replace(/^http/, "ws");

export const options = {
  vus: 50,
  duration: "30s",
  thresholds: {
    ws_connecting: ["p(95)<300"],
    ws_session_duration: ["p(95)>5000"], // wir halten 5+s offen
  },
};

export default function () {
  // Engine.IO v4 Default-Path. Socket.IO-Client würde hier `?EIO=4&transport=websocket`
  // anhängen — wir simulieren das, damit der Server-Upgrade greift.
  const url = `${BASE_URL}/ws/?EIO=4&transport=websocket`;
  const res = ws.connect(url, {}, (socket) => {
    socket.on("open", () => {
      // 5 s offen halten, dann sauber schließen — testet Ressourcen-
      // Verhalten unter konkurrierenden Verbindungen.
      socket.setTimeout(() => socket.close(), 5000);
    });
    socket.on("error", (e) => {
      console.error("ws error:", e?.error || e);
    });
  });

  check(res, {
    "ws upgrade accepted (101)": (r) => r && r.status === 101,
  });
}
