/**
 * Hook fürs Spielen am Bodensee-Tisch.
 *
 * Lebenszyklus pro `gameId` — analog zu `useGameView`, aber auf dem
 * eigenen `bodensee:*`-WS-Pfad:
 *   1. Beim Mount: `socket.emit("bodensee:join", { gameId })`. Der Server
 *      schickt sofort `bodensee:state` mit dem aktuellen `BodenseeView`.
 *   2. Bei jedem `bodensee:state`-Event aktualisieren wir den State.
 *   3. `playCard(card)` schickt `bodensee:move`, `announce(a)` schickt
 *      `bodensee:announce`. Server validiert → broadcastet → neuer
 *      `bodensee:state` kommt zurück und löscht den pending-Flag.
 *
 * `bodensee:error`-Events landen im `error`-State (z.B. „Karte illegal").
 */
import type { Card } from "@jass/engine";
import { useEffect, useRef, useState } from "react";

import i18n from "~/i18n";
import { getLobbySocket } from "~/lib/ws";
import type { BodenseeAnnouncement, BodenseeView } from "./types";

export interface BodenseeViewState {
  view: BodenseeView | null;
  error: string | null;
  /** true, solange ein `bodensee:move` unterwegs ist. */
  movePending: boolean;
  /** true, solange ein `bodensee:announce` unterwegs ist. */
  announcePending: boolean;
  playCard: (card: Card) => void;
  announce: (announcement: BodenseeAnnouncement) => void;
  clearError: () => void;
}

export function useBodenseeView(gameId: string | null): BodenseeViewState {
  const [view, setView] = useState<BodenseeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [movePending, setMovePending] = useState(false);
  const [announcePending, setAnnouncePending] = useState(false);
  const gameIdRef = useRef<string | null>(gameId);
  gameIdRef.current = gameId;

  useEffect(() => {
    if (!gameId) return;
    const socket = getLobbySocket();

    function onState(v: BodenseeView) {
      setView(v);
      setMovePending(false);
      setAnnouncePending(false);
      setError(null);
    }
    function onError(e: { message?: string }) {
      setError(e?.message ?? i18n.t("game.errorFallback"));
      setMovePending(false);
      setAnnouncePending(false);
    }

    socket.on("bodensee:state", onState);
    socket.on("bodensee:error", onError);
    socket.emit("bodensee:join", { gameId });

    return () => {
      socket.off("bodensee:state", onState);
      socket.off("bodensee:error", onError);
    };
  }, [gameId]);

  function playCard(card: Card) {
    const id = gameIdRef.current;
    if (!id) return;
    setMovePending(true);
    getLobbySocket().emit("bodensee:move", {
      gameId: id,
      card: { suit: card.suit, rank: card.rank },
    });
  }

  function announce(announcement: BodenseeAnnouncement) {
    const id = gameIdRef.current;
    if (!id) return;
    setAnnouncePending(true);
    getLobbySocket().emit("bodensee:announce", { gameId: id, announcement });
  }

  function clearError() {
    setError(null);
  }

  return { view, error, movePending, announcePending, playCard, announce, clearError };
}
