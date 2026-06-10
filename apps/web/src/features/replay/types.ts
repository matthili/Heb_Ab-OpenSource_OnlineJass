/**
 * Replay-Frontend-Types — Spiegel von `apps/api/src/modules/game/replay.service.ts`.
 * Klein gehalten, damit das Bundle nicht aufquillt; die volle Schema-
 * Spezifikation lebt auf der API-Seite.
 */
import type { Suit } from "@jass/engine";

export type GameVariant = "KREUZ_4P" | "KREUZ_6P" | "KREUZ_STEIGERN" | "BODENSEE_2P";

export interface ReplaySeat {
  seat: number;
  userId: string | null;
  displayName: string | null;
  aiSeatType: string | null;
}

export interface ReplayRound {
  roundIdx: number;
  mode: string; // "TRUMPF" | "GUMPF" | "OBEN" | "UNTEN"
  trumpSuit: number | null; // 0..3
  starter: number;
  weisen: unknown;
  /** Slalom-Ansage? (Modus alterniert pro Stich.) */
  slalom: boolean;
  /** Bodensee: initialer Deal `{ hands, tables }` | null (immer null bei Kreuz/Solo). */
  bodenseeDeal: unknown;
}

export interface ReplayMove {
  seq: number;
  seat: number;
  cardIndex: number;
  trickIdx: number;
  ts: string;
  userId: string | null;
}

export interface ReplayFinalScore {
  team_card_points: number[];
  matsch_team: number | null;
  trick_winners: number[];
}

export interface ReplayBundle {
  gameId: string;
  variant: GameVariant;
  ruleVersion: string;
  modelVersion: string | null;
  startedAt: string;
  endedAt: string | null;
  status: "playing" | "finished";
  finalScore: ReplayFinalScore | null;
  seats: ReplaySeat[];
  rounds: ReplayRound[];
  moves: ReplayMove[];
  /** Spec „teilbare Replays": `true` → via `/r/:gameId` ohne Login einsehbar. */
  publicReplay: boolean;
}

export interface UserGameSummary {
  gameId: string;
  variant: GameVariant;
  mySeat: number;
  myTeam: number;
  startedAt: string;
  endedAt: string | null;
  status: "playing" | "finished";
  finalScore: ReplayFinalScore | null;
  seats: ReplaySeat[];
}

export const SUIT_BY_ID: readonly Suit[] = ["EICHEL", "SCHELLE", "HERZ", "LAUB"];
