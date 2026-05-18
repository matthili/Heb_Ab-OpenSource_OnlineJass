/**
 * Game-Frontend-Types — Spiegel von `apps/api/src/modules/game/game.service.ts`
 * (PlayerView). M11 ersetzt das durch generierte OpenAPI-Types.
 */
import type { Card, GameState, PlayMode, Suit } from "@jass/engine";

export interface FinalScore {
  team_card_points: readonly number[];
  matsch_team: number | null;
  trick_winners: readonly number[];
}

/**
 * Drei Phasen:
 *   - `announcing`: warten auf Trumpf-Ansage. `state` ist null, `announcement` ist gesetzt.
 *   - `playing`: regulärer Spiel-Modus.
 *   - `finished`: Spielende, mit `finalScore`.
 */
export interface PlayerView {
  gameId: string;
  status: "announcing" | "playing" | "finished";
  /** Eigener Sitz im Game (0..3). In allen Phasen verfügbar. */
  mySeat: number;
  state: GameState | null;
  hand: readonly Card[];
  legalActionMask: readonly number[];
  whoseTurnSeat: number;
  myTurn: boolean;
  announcement?: {
    announcerSeat: number;
    iAmAnnouncer: boolean;
    canPush: boolean;
    pushedFromSeat: number | null;
  };
  finalScore?: FinalScore;
  /**
   * **Stöck**: Ist mein eigener Sitz gerade berechtigt, „Stöck" zu rufen?
   * (= ich habe soeben die zweite Trumpf-OBER/KOENIG-Karte gespielt und
   *  noch nicht angesagt + noch nicht den nächsten Zug gemacht.) Der
   *  Button bleibt sichtbar bis ich klicke oder meine nächste Karte spiele.
   */
  stoeckEligible: boolean;
  /** Team, das offiziell Stöck angesagt hat (für UI-Anzeige). */
  stoeckAnnouncedTeam?: number | null;
}

/**
 * Wire-Format für das `game:announce`-WS-Event. Spiegel von
 * `AnnouncementDecision` im Backend.
 */
export type AnnouncementDecision =
  | { kind: "push" }
  | {
      kind: "announce";
      mode: PlayMode;
      trumpSuit?: Suit;
      slalom?: boolean;
    };

export type RematchOutcome =
  | { kind: "pending"; remainingVotes: number }
  | { kind: "rematch-started"; gameId: string; starter: number }
  | { kind: "back-to-waiting"; removedUserIds: string[] };
