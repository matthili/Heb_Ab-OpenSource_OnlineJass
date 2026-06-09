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

import i18n from "~/i18n";
import { getLobbySocket } from "~/lib/ws";
import type { AnnouncementDecision, PlayerView } from "./types";

export interface GameViewState {
  view: PlayerView | null;
  error: string | null;
  /** true, solange ein `game:move` unterwegs ist. */
  movePending: boolean;
  /** true, solange ein `game:announce` unterwegs ist. */
  announcePending: boolean;
  /** true, solange ein `game:cut` unterwegs ist. */
  cutPending: boolean;
  /** true, solange ein `game:weisen-*` Roundtrip unterwegs ist. */
  weisenPending: boolean;
  playCard: (card: Card) => void;
  /** Trumpf-Ansage (oder Push) absenden. */
  announce: (decision: AnnouncementDecision) => void;
  /** Abheben (cutIndex 1..deckSize-1) oder klopfen (cutIndex 0). */
  cut: (cutIndex: number) => void;
  /** „Stöck" rufen — nur erlaubt, wenn `view.stoeckEligible`. */
  announceStoeck: () => void;
  /**
   * „Weisen"-Button klicken. Eröffnet das Selection-Window für die
   * nachfolgende Karten-Auswahl. Wird vom Server bei geschlossenem
   * Window zurückgewiesen (`game:error`).
   */
  clickWeisen: () => void;
  /**
   * Eine oder mehrere Weisen-Gruppen submitten.
   * Jede `groups`-Untergruppe ist eine separate Deklaration
   * (z.B. 3-Blatt + 4×Asse zugleich). Karten innerhalb einer Gruppe
   * müssen ein valider Weis sein; Karten dürfen nicht über Gruppen
   * hinweg dupliziert werden — Server validiert beides re.
   */
  submitWeisen: (groups: ReadonlyArray<ReadonlyArray<Card>>) => void;
  clearError: () => void;
}

export function useGameView(gameId: string | null): GameViewState {
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [movePending, setMovePending] = useState(false);
  const [announcePending, setAnnouncePending] = useState(false);
  const [cutPending, setCutPending] = useState(false);
  const [weisenPending, setWeisenPending] = useState(false);
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
      setCutPending(false);
      setWeisenPending(false);
      // State-Update räumt einen alten Move-Fehler auf, sobald ein
      // legitimer State eintrifft.
      setError(null);
    }
    function onError(e: { message?: string }) {
      setError(e?.message ?? i18n.t("game.errorFallback"));
      setMovePending(false);
      setAnnouncePending(false);
      setCutPending(false);
      setWeisenPending(false);
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

  // Fehler-Banner nach kurzer Zeit automatisch ausblenden — so hängt man nie
  // dauerhaft vor einer Meldung fest (z.B. „Stöck wurde bereits angesagt"),
  // wenn danach kein neuer State mehr kommt. Zusätzlich zum Clear bei jedem
  // eintreffenden `game:state`. 6 s reichen zum Lesen.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(id);
  }, [error]);

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

  function cut(cutIndex: number) {
    const id = gameIdRef.current;
    if (!id) return;
    const socket = getLobbySocket();
    setCutPending(true);
    socket.emit("game:cut", { gameId: id, cutIndex });
  }

  function announceStoeck() {
    const id = gameIdRef.current;
    if (!id) return;
    const socket = getLobbySocket();
    socket.emit("game:announce-stoeck", { gameId: id });
  }

  function clickWeisen() {
    const id = gameIdRef.current;
    if (!id) return;
    const socket = getLobbySocket();
    setWeisenPending(true);
    socket.emit("game:weisen-click", { gameId: id });
  }

  function submitWeisen(groups: ReadonlyArray<ReadonlyArray<Card>>) {
    const id = gameIdRef.current;
    if (!id) return;
    const socket = getLobbySocket();
    setWeisenPending(true);
    // Cards werden 1:1 als {suit, rank}-Tupel über Wire geschickt — das
    // Backend akzeptiert exakt diese Form (vgl. `game:weisen-submit`-Handler
    // im gateway). Wir kopieren explizit, damit kein Frozen-Array über die
    // Socket.IO-Serializer-Grenze geht (manche Server crashen sonst).
    const payload = groups.map((g) => g.map((c) => ({ suit: c.suit, rank: c.rank })));
    socket.emit("game:weisen-submit", { gameId: id, groups: payload });
  }

  function clearError() {
    setError(null);
  }

  return {
    view,
    error,
    movePending,
    announcePending,
    cutPending,
    weisenPending,
    playCard,
    announce,
    cut,
    announceStoeck,
    clickWeisen,
    submitWeisen,
    clearError,
  };
}
