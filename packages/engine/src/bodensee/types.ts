/**
 * **Bodensee-Jass — Typen.**
 *
 * Bodensee ist die 2-Spieler-Variante mit Tisch-Mechanik. Jeder Spieler hat
 * 18 Karten, verteilt auf:
 *   - **Hand** (0–6 Karten, privat)
 *   - **6 Tisch-Stapel**, jeder anfangs `{ visible, hidden }` (2 Karten)
 *
 * Spielbar ist immer nur der „Pool" = Hand + sichtbare Tisch-Karten.
 * Spielt man eine sichtbare Tisch-Karte, rückt die verdeckte darunter
 * (`hidden`) auf die `visible`-Position nach.
 *
 * TS-Port von `jass_engine/bodensee/` aus dem NN-Schwester-Repo.
 */
import type { Announcement, Card, CompletedTrick, Variant } from "../types.js";

/** 2 Spieler, 18 Stiche, 6 Hand + 6 Tisch-Stapel. */
export const BODENSEE_NUM_PLAYERS = 2;
export const BODENSEE_HAND_SIZE = 6;
export const BODENSEE_TABLE_STACKS = 6;
export const BODENSEE_TRICKS_PER_ROUND = 18;
/** Default-Punkteziel einer Bodensee-Partie. */
export const BODENSEE_DEFAULT_TARGET = 500;

/**
 * Ein Tisch-Stapel. Lifecycle:
 *   1. frisch:       `{ visible: A, hidden: B }`
 *   2. nach 1. Spiel: `{ visible: B, hidden: null }`
 *   3. nach 2. Spiel: `{ visible: null, hidden: null }` (leer)
 */
export interface TableStack {
  readonly visible: Card | null;
  readonly hidden: Card | null;
}

/**
 * **Server-interner Voll-Zustand** einer Bodensee-Runde. Enthält beide
 * Hände + beide Tische komplett (auch verdeckte Karten) — verlässt den
 * Server nie ungefiltert; `bodenseeViewAsPlayer` schneidet die private
 * Information weg.
 */
export interface BodenseeRoundState {
  readonly variant: Variant; // pro-Stich-effektiv (bei Slalom wechselnd)
  readonly announcement: Announcement;
  /** 2 Hände (Spieler 0, 1). */
  readonly hands: readonly (readonly Card[])[];
  /** 2 Tische, je 6 Stapel. */
  readonly tables: readonly (readonly TableStack[])[];
  /** 0–1 Karten im laufenden Stich. */
  readonly current_trick_cards: readonly Card[];
  /** Wer hat den laufenden Stich angespielt (0 | 1). */
  readonly current_trick_starter: number;
  readonly completed_tricks: readonly CompletedTrick[];
  /** Gewinner je abgeschlossenem Stich (0 | 1). */
  readonly trick_winners: readonly number[];
  /** Karten-Punkte je Spieler (ohne Matsch-Bonus — der kommt in finalScore). */
  readonly player_card_points: readonly number[];
  /** Wer hat angesagt (0 | 1) — = WELI-Halter in Runde 1. */
  readonly announcer_idx: number;
  readonly round_idx: number;
  readonly trick_idx: number; // 0..17
  /** Tisch-Option „Sack": < SACK_MIN_POINTS Kartenpunkte → nichts gewertet.
   *  (Alt-State ohne Feld = aus.) */
  readonly sack_rule?: boolean;
}

/**
 * **Per-Spieler-Sicht** auf einen Bodensee-Spielzustand — das, was ein
 * Spieler beim Zug sieht. Enthält keine verdeckten Karten (auch nicht die
 * eigenen). Spiegelt `BodenseeGameState` aus dem NN-Repo + ist der
 * Encoder-Input.
 */
export interface BodenseeGameState {
  readonly player_idx: number; // 0 | 1 — ich
  readonly variant: Variant;
  readonly announcement: Announcement;
  readonly current_trick_cards: readonly Card[];
  readonly current_trick_starter: number;
  readonly completed_tricks: readonly CompletedTrick[];
  /** Sichtbare Tisch-Karten des Gegners. */
  readonly opponent_visible_table: readonly Card[];
  readonly opponent_hand_count: number;
  readonly opponent_hidden_table_count: number;
  /** Anzahl noch verdeckter eigener Tisch-Karten. */
  readonly own_hidden_table_count: number;
  readonly own_score: number;
  readonly opp_score: number;
  readonly round_idx: number;
  readonly trick_idx: number;
}

/**
 * Vollständige Encoder-Eingabe. Entspricht 1:1 dem `input`-Objekt der
 * `bodensee_encoding_fixtures.json` — so wird der Fixture-Test trivial.
 */
export interface BodenseeEncoderInput {
  readonly hand: readonly Card[];
  /** Eigene Tisch-Stapel als `{ visible, has_hidden }` — die verdeckte
   *  Karte selbst kennt der Encoder nicht (nur die Masken-Info). */
  readonly own_table: readonly { visible: Card | null; has_hidden: boolean }[];
  readonly variant_effective: Variant;
  readonly announcement: Announcement;
  readonly current_trick_cards: readonly Card[];
  readonly current_trick_starter: number;
  readonly player_idx: number;
  readonly completed_tricks: readonly CompletedTrick[];
  readonly opponent_visible_table: readonly Card[];
  readonly opponent_hand_count: number;
  readonly opponent_hidden_table_count: number;
  readonly own_hidden_table_count: number;
  readonly own_score: number;
  readonly opp_score: number;
  readonly round_idx: number;
  readonly trick_idx: number;
  readonly i_am_announcer: boolean;
}

/** Bodensee-Move: ein Spieler legt eine Karte (aus Hand oder vom Tisch). */
export interface BodenseeMove {
  readonly player: number; // 0 | 1
  readonly card: Card;
}

/** Ergebnis einer abgeschlossenen Bodensee-Runde. */
export interface BodenseeRoundScore {
  /** Karten-Punkte je Spieler, inkl. Matsch-Bonus. */
  readonly player_total_points: readonly number[];
  /** Spieler (0 | 1), der alle 18 Stiche gewann — sonst null. */
  readonly matsch_player: number | null;
  readonly trick_winners: readonly number[];
  /**
   * Spieler, deren Punkte durch „Sack" (< SACK_MIN_POINTS Kartenpunkte)
   * verfallen sind — weggelassen, wenn keiner betroffen war.
   */
  readonly voided?: readonly { player: number; cardPoints: number }[];
}
