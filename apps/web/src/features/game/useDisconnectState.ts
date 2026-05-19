/**
 * Hook für den Disconnect-Vote-State des aktuellen Games.
 *
 * Hört auf zwei WS-Events:
 *   - `game:disconnect-state` — voller State-Push (Phase, Restzeit,
 *     Votes, disconnectedSeats, resultMessage). Sender: Backend bei
 *     jedem Phasen-Übergang ODER nach jedem Vote.
 *   - `game:disconnect-closed` — Marker, dass der Tisch wegen STOP-
 *     Outcome geschlossen wurde. Im disconnect-state ist die Phase
 *     dann schon CLOSED, aber dieses Event ist ein zusätzlicher
 *     Hinweis fürs Result-Overlay.
 *
 * Returnt:
 *   - aktueller State (null wenn keine Disconnect-Session läuft)
 *   - `vote(choice)` zum Stimmabgeben (sendet `game:disconnect-vote`)
 *   - `dismissResult()` zum Schließen des Result-Overlay (resetet State
 *     lokal, navigiert zur Lobby beim CLOSED-Outcome)
 */
import { useEffect, useState } from "react";

import { getLobbySocket } from "~/lib/ws";

export type DisconnectPhase = "GRACE_1" | "VOTE_1" | "GRACE_2" | "VOTE_2" | "CLOSED" | "CONTINUED";

export type VoteChoice = "STOP" | "WAIT" | "FILL";

export interface DisconnectState {
  phase: DisconnectPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  disconnectedSeats: Array<{ seat: number; userId: string }>;
  participants: Array<{ seat: number; kind: "HUMAN" | "AI" }>;
  votes: Record<number, VoteChoice>;
  aiAutoVotes: Array<{ seat: number; choice: VoteChoice }>;
  resultMessage: string | null;
  resultOutcome: "STOP" | "WAIT" | "FILL" | null;
}

export interface UseDisconnectStateResult {
  state: DisconnectState | null;
  /** Eigene Stimme absetzen. */
  vote: (choice: VoteChoice) => void;
  /** Result-Overlay schließen (lokal, nicht serverseitig). */
  dismissResult: () => void;
}

export function useDisconnectState(gameId: string | null): UseDisconnectStateResult {
  const [state, setState] = useState<DisconnectState | null>(null);

  useEffect(() => {
    if (!gameId) return;
    const s = getLobbySocket();
    const onState = (payload: DisconnectState) => setState(payload);
    const onClosed = (payload: { reason?: string }) => {
      // Sicherheits-Net: falls das eigentliche `game:disconnect-state` mit
      // phase=CLOSED nicht ankommt (Race), reichen wir den Reason
      // synthetisch nach.
      setState((cur) =>
        cur
          ? { ...cur, phase: "CLOSED", resultMessage: payload?.reason ?? cur.resultMessage }
          : null
      );
    };
    s.on("game:disconnect-state", onState);
    s.on("game:disconnect-closed", onClosed);
    return () => {
      s.off("game:disconnect-state", onState);
      s.off("game:disconnect-closed", onClosed);
    };
  }, [gameId]);

  function vote(choice: VoteChoice) {
    if (!gameId) return;
    getLobbySocket().emit("game:disconnect-vote", { gameId, choice });
  }

  function dismissResult() {
    setState(null);
  }

  return { state, vote, dismissResult };
}
