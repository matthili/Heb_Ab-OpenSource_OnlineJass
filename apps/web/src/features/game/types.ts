/**
 * Game-Frontend-Types — Spiegel von `apps/api/src/modules/game/game.service.ts`
 * (PlayerView). M11 ersetzt das durch generierte OpenAPI-Types.
 */
import type { Card, GameState } from "@jass/engine";

export interface FinalScore {
  team_card_points: readonly number[];
  matsch_team: number | null;
  trick_winners: readonly number[];
}

export interface PlayerView {
  gameId: string;
  status: "playing" | "finished";
  state: GameState;
  hand: readonly Card[];
  legalActionMask: readonly number[];
  whoseTurnSeat: number;
  myTurn: boolean;
  finalScore?: FinalScore;
}

export type RematchOutcome =
  | { kind: "pending"; remainingVotes: number }
  | { kind: "rematch-started"; gameId: string; starter: number }
  | { kind: "back-to-waiting"; removedUserIds: string[] };
