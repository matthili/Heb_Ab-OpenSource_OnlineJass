/**
 * Frontend-Types für Bodensee-Jass — Spiegel von `BodenseePlayerView`
 * (`apps/api/src/modules/game/bodensee-game.service.ts`).
 *
 * Bodensee ist die 2-Spieler-Variante: jeder Spieler hat eine Hand plus
 * 6 Tisch-Stapel (sichtbare + verdeckte Karte). Spielbar ist der „Pool"
 * aus Handkarten und sichtbaren Tisch-Karten.
 */
import type { AnnounceLevel, Card, PlayMode, Suit } from "@jass/engine";

/** Ein Tisch-Stapel in der Client-Sicht — `hidden` ist nur als Flag bekannt. */
export interface BodenseeTableStackView {
  visible: Card | null;
  hasHidden: boolean;
}

/** Per-Sitz-Sicht auf ein Bodensee-Game. */
export interface BodenseeView {
  gameId: string;
  variant: "bodensee";
  status: "announcing" | "playing" | "finished";
  mySeat: number;
  hand: readonly Card[];
  ownTable: readonly BodenseeTableStackView[];
  /** Gegner-Stapel — positionsgleich zu `ownTable`; `hasHidden` ohne Karten-Wert. */
  opponentTable: readonly BodenseeTableStackView[];
  opponentHandCount: number;
  legalActionMask: readonly number[];
  whoseTurnSeat: number;
  myTurn: boolean;
  playMode?: PlayMode;
  trumpSuit?: Suit;
  /** Stabiles Slalom-Flag der Ansage (für Modus-Symbol/Overlay). */
  slalom?: boolean;
  trickIdx: number;
  ownScore: number;
  oppScore: number;
  currentTrick: { cards: readonly Card[]; starter: number };
  lastTrick?: { cards: readonly Card[]; starter: number; winner: number };
  /** Erster Stich der Runde — dauerhaft als Mini angezeigt. */
  firstTrick?: { cards: readonly Card[]; starter: number; winner: number };
  announcement?: { announcerSeat: number; iAmAnnouncer: boolean; announceLevel: AnnounceLevel };
  finalScore?: { player_total_points: readonly number[]; matsch_player: number | null };
}

/** Wire-Format für das `bodensee:announce`-WS-Event. */
export interface BodenseeAnnouncement {
  variant: { mode: PlayMode; trump_suit?: Suit };
  slalom: boolean;
}
