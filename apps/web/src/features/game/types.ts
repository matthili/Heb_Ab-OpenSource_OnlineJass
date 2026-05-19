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
 * Mirror von `WeisDeclarationView` im Backend (`apps/api/.../game.service.ts`).
 * Felder sind so übertragen, dass die UI Karten 1:1 in `Card`-Komponenten
 * rendern kann.
 */
export interface WeisDeclarationView {
  kind: string;
  cards: ReadonlyArray<{ suit: string; rank: string }>;
  points: number;
}

/**
 * Mirror von `PlayerView.weisen` im Backend (game.service.ts).
 *   - `myStatus`: pro-Sitz-Stand der Weisen-Phase.
 *   - `canClickButton`: nur true, wenn das Window für mich offen ist.
 *   - `myDeclarations`: bereits abgegebene Deklarationen meines Sitzes.
 *   - `result`: nach Trick-1-Aggregation gesetzt — enthält Sieger-Team und
 *     alle Deklarationen pro Sitz (auch fremde, die nun publik sind).
 */
export interface WeisenView {
  myStatus: "PENDING" | "OPEN" | "SUBMITTED" | "MISSED" | "EVALUATED";
  canClickButton: boolean;
  myDeclarations: ReadonlyArray<WeisDeclarationView>;
  result?: {
    winningTeam: number | null;
    points: number;
    perSeat: ReadonlyArray<{
      seat: number;
      declarations: ReadonlyArray<WeisDeclarationView>;
    }>;
  };
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
  /**
   * Weisen-Status für den eigenen Sitz. UI rendert daraus den
   * Weisen-Button, den Selection-Mode und das Result-Overlay nach Trick 1.
   */
  weisen: WeisenView;
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
