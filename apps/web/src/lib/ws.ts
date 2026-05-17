/**
 * Socket.IO-Client als Modul-Singleton + React-Hooks.
 *
 * **Verbindung**: Lazy initialisiert beim ersten Hook-Aufruf. Geht über
 * den Vite-Proxy (`/ws` → `:3000/ws`) auf die API. Browser sendet den
 * Better-Auth-Cookie mit, weil same-origin (5173).
 *
 * **Lifecycle**: Der Socket bleibt für die Browser-Tab-Lebenszeit
 * aktiv. Auf der Server-Seite registriert sich der Socket
 * automatisch in `lobby:user:<id>` (siehe LobbyGateway.afterInit).
 *
 * **Hooks**:
 *   - `useLobbyListEvents(handler)` — abonniert die Lobby-Liste,
 *     ruft `handler(reason, tableId?)` bei jedem Push.
 *   - `useTableStateEvents(tableId, handler)` — abonniert einen
 *     einzelnen Tisch, ruft `handler(view)` bei State-Updates.
 *   - `useUserEvents(event, handler)` — abonniert ein User-Event auf
 *     dem persönlichen Kanal (Invites, Request-Decisions, …).
 */
import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

function getSocket(): Socket {
  if (socket) return socket;
  socket = io({
    path: "/ws",
    transports: ["websocket"],
    // Cookie wird automatisch vom Browser mitgesendet (same-origin).
    // `withCredentials: true` ist explizit für CORS-Sicherheits-Checks.
    withCredentials: true,
    reconnection: true,
  });
  return socket;
}

/**
 * Subscriptions live auf dem Server: jeder hook joint die zugehörige
 * Room und leavt beim Unmount. Idempotent — mehrere Komponenten dürfen
 * gleichen Room abonnieren.
 */
export function useLobbyListEvents(
  handler: (payload: { reason: string; tableId?: string }) => void
): void {
  useEffect(() => {
    const s = getSocket();
    const onUpdate = (p: { reason: string; tableId?: string }) => handler(p);
    s.emit("lobby:subscribe-list");
    s.on("lobby:tables-updated", onUpdate);
    return () => {
      s.off("lobby:tables-updated", onUpdate);
      s.emit("lobby:unsubscribe-list");
    };
  }, [handler]);
}

export function useTableStateEvents(
  tableId: string | null,
  handler: (view: unknown) => void
): void {
  useEffect(() => {
    if (!tableId) return;
    const s = getSocket();
    const onState = (view: unknown) => handler(view);
    const onClosed = () => handler(null);
    s.emit("lobby:subscribe-table", { tableId });
    s.on("lobby:table-state", onState);
    s.on("lobby:table-closed", onClosed);
    return () => {
      s.off("lobby:table-state", onState);
      s.off("lobby:table-closed", onClosed);
      s.emit("lobby:unsubscribe-table", { tableId });
    };
  }, [tableId, handler]);
}

export function useUserEvents(event: string, handler: (payload: unknown) => void): void {
  useEffect(() => {
    const s = getSocket();
    const wrapped = (p: unknown) => handler(p);
    s.on(event, wrapped);
    return () => {
      s.off(event, wrapped);
    };
  }, [event, handler]);
}

/**
 * Gibt den Socket-Singleton zurück — nützlich für Aktionen wie
 * `socket.emit("game:join", { gameId })` aus M7-D.
 */
export function getLobbySocket(): Socket {
  return getSocket();
}
