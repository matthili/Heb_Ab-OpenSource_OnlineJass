/**
 * Hook für den Disconnect-Vote-State des aktuellen Games.
 *
 * Hört auf drei WS-Events:
 *   - `game:disconnect-state` — voller State-Push (Phase, Restzeit,
 *     Votes, disconnectedSeats, resultMessage). Sender: Backend bei
 *     jedem Phasen-Übergang ODER nach jedem Vote.
 *   - `game:disconnect-closed` — Marker, dass der Tisch wegen STOP-
 *     Outcome geschlossen wurde. Im disconnect-state ist die Phase
 *     dann schon CLOSED, aber dieses Event ist ein zusätzlicher
 *     Hinweis fürs Result-Overlay.
 *   - `game:disconnect-cleared` — autoritatives „Episode vorbei" nach dem
 *     CONTINUED-Linger. Primärer Weg, das Overlay auszublenden; der
 *     Client-Timer (unten) ist nur Fallback, falls dieses Event mal
 *     verloren geht (z. B. exakt im Reload-Race).
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
    // Autoritatives „Episode vorbei" vom Server — primärer Weg, das Overlay
    // auszublenden (statt blind auf den Client-Timer unten zu hoffen).
    const onCleared = () => setState(null);
    s.on("game:disconnect-state", onState);
    s.on("game:disconnect-closed", onClosed);
    s.on("game:disconnect-cleared", onCleared);
    return () => {
      s.off("game:disconnect-state", onState);
      s.off("game:disconnect-closed", onClosed);
      s.off("game:disconnect-cleared", onCleared);
    };
  }, [gameId]);

  // Fallback-Timer fürs CONTINUED-Overlay: Primär blendet das Overlay auf das
  // autoritative `game:disconnect-cleared` hin aus (siehe oben). Falls dieses
  // Event aber mal nicht ankommt (z. B. exakt im Reload-Race), zieht sich das
  // rein informative „alle wieder verbunden"-Overlay nach kurzem Linger selbst
  // zurück — es hat keinen Button und darf nicht kleben bleiben.
  useEffect(() => {
    if (state?.phase !== "CONTINUED") return;
    const id = setTimeout(() => setState(null), 3500);
    return () => clearTimeout(id);
  }, [state?.phase]);

  function vote(choice: VoteChoice) {
    if (!gameId) return;
    getLobbySocket().emit("game:disconnect-vote", { gameId, choice });
  }

  function dismissResult() {
    setState(null);
  }

  return { state, vote, dismissResult };
}
