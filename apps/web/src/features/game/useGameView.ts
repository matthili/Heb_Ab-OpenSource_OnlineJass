/**
 * Hook fürs Spielen am Tisch.
 *
 * Lebenszyklus pro `gameId`:
 *   1. WS-Verbindung steht schon (LobbyGateway hat den Socket gejoint).
 *   2. Beim Mount: `socket.emit("game:join", { gameId })`. Der Server
 *      schickt sofort `game:state` mit dem aktuellen PlayerView.
 *   3. Bei jedem `game:state`-Event aktualisieren wir den State.
 *   4. `playCard(card)` schickt `game:move`. Server validiert → broadcastet
 *      → neuer `game:state` kommt zurück. Wir reseten den optimistic
 *      pending-Flag dann.
 *   5. Beim Unmount: kein explizites `game:leave` — der Socket bleibt
 *      verbunden, aber wir hören keine Events mehr. (Server-seitig
 *      hat der Socket eine Room-Mitgliedschaft, die mit dem
 *      Tab-Disconnect endet.)
 *
 * **Game-Error**: Wir sammeln `game:error`-Events in einem lokalen
 * `error`-State und exponieren ihn — die UI kann z.B. „Karte illegal"
 * anzeigen.
 */
import type { Card } from "@jass/engine";
import { useEffect, useRef, useState } from "react";

import { getLobbySocket } from "~/lib/ws";
import type { AnnouncementDecision, PlayerView } from "./types";

export interface GameViewState {
  view: PlayerView | null;
  error: string | null;
  /** true, solange ein `game:move` unterwegs ist. */
  movePending: boolean;
  /** true, solange ein `game:announce` unterwegs ist. */
  announcePending: boolean;
  playCard: (card: Card) => void;
  /** Trumpf-Ansage (oder Push) absenden. */
  announce: (decision: AnnouncementDecision) => void;
  clearError: () => void;
}

export function useGameView(gameId: string | null): GameViewState {
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [movePending, setMovePending] = useState(false);
  const [announcePending, setAnnouncePending] = useState(false);
  // Ref zum letzten gameId, damit der play-Callback nicht stale wird.
  const gameIdRef = useRef<string | null>(gameId);
  gameIdRef.current = gameId;

  useEffect(() => {
    if (!gameId) return;
    const socket = getLobbySocket();

    function onState(v: PlayerView) {
      setView(v);
      setMovePending(false);
      setAnnouncePending(false);
      // State-Update räumt einen alten Move-Fehler auf, sobald ein
      // legitimer State eintrifft.
      setError(null);
    }
    function onError(e: { message?: string }) {
      setError(e?.message ?? "Spielfehler");
      setMovePending(false);
      setAnnouncePending(false);
    }

    socket.on("game:state", onState);
    socket.on("game:error", onError);
    // Initiales Join — Server schickt unmittelbar `game:state` zurück.
    socket.emit("game:join", { gameId });

    return () => {
      socket.off("game:state", onState);
      socket.off("game:error", onError);
    };
  }, [gameId]);

  function playCard(card: Card) {
    const id = gameIdRef.current;
    if (!id) return;
    const socket = getLobbySocket();
    setMovePending(true);
    socket.emit("game:move", { gameId: id, card });
  }

  function announce(decision: AnnouncementDecision) {
    const id = gameIdRef.current;
    if (!id) return;
    const socket = getLobbySocket();
    setAnnouncePending(true);
    socket.emit("game:announce", { gameId: id, decision });
  }

  function clearError() {
    setError(null);
  }

  return { view, error, movePending, announcePending, playCard, announce, clearError };
}
