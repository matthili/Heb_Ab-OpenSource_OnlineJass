/**
 * Server-autoritativer Round-State + immutable Reducer (`applyMove`).
 *
 * **Trennung der Sichten:**
 *   - `RoundState`: vollständig, inkl. aller Spieler-Hände. Lebt nur auf dem
 *     Server (Redis-Cache + Postgres-Move-Log). Wird NIEMALS unverändert an
 *     Clients ausgespielt.
 *   - `GameState` (in `types.ts`): per-Spieler-Perspektive, ohne fremde Hände.
 *     Das ist was der Encoder verarbeitet und was über die WS an einen
 *     einzelnen Client geschickt wird. `viewAsPlayer()` baut diese Sicht aus
 *     dem `RoundState`.
 *
 * **Lifecycle:**
 *   1. `dealCards(rng)` → 4 × 9 Karten
 *   2. `newRound({variant, announcement, hands, starter, teams})` → RoundState
 *   3. Schleife: `applyMove(state, {seat, card})` bis `isRoundDone(state)`
 *   4. `finalRoundScore(state)` → Karten-Punkte pro Team, Matsch-Flag
 *
 * **Validierung in `applyMove`:**
 *   - Move-Seat muss `whoseTurn(state)` entsprechen
 *   - Karte muss in der Hand sein
 *   - Karte muss in `legalMoves(...)` enthalten sein
 *
 * Bewusst ausgeklammert für M4 (kommt mit M6+): Weisen, Stöcke, Matsch-Bonus
 * im Score, Slalom-Modus-Wechsel pro Trick, Push-to-Partner-Ansage.
 */

import { cardsEqual } from "./cards.js";
import { legalMoves, trickPoints, trickWinner } from "./rules.js";
import {
  type Announcement,
  type Card,
  type CompletedTrick,
  type GameState,
  type Variant,
  MATCH_BONUS,
  NUM_PLAYERS,
  TRICKS_PER_ROUND,
  DECK_SIZE,
  RANKS,
  SUITS,
} from "./types.js";

// ---------------------------------------------------------------------
// RoundState — Server-vollständige Sicht
// ---------------------------------------------------------------------

export interface RoundState {
  readonly variant: Variant; // Pro Trick effektive Variante (Slalom: schon aufgelöst)
  readonly announcement: Announcement;
  readonly teams: readonly number[]; // Standard [0, 1, 0, 1] für Kreuz-Jass
  readonly num_players: number;
  readonly round_idx: number;

  // Hände pro Sitz, in Sitz-Reihenfolge. Karten werden bei jedem Move aus der
  // Hand des spielenden Sitzes entfernt.
  readonly hands: readonly (readonly Card[])[];

  // Aktueller Trick
  readonly trick_idx: number; // 0..8, wechselt nach Trick-Abschluss
  readonly current_trick_starter: number; // 0..3, Anspieler des aktuellen Tricks
  readonly current_trick_cards: readonly Card[];

  // Historie abgeschlossener Tricks, in chronologischer Reihenfolge
  readonly completed_tricks: readonly CompletedTrick[];

  // Live-Punkte pro Team aus Kartenwerten + Letzter-Stich-Bonus.
  // Index = Team-ID (0 oder 1 bei Kreuz-Jass). Matsch-Bonus wird in
  // `finalRoundScore()` separat berechnet, nicht hier mitgeführt.
  readonly team_card_points: readonly number[];

  // Gewinner pro abgeschlossenem Trick (Sitz-Index), für Matsch-Check und
  // Replay-Rekonstruktion.
  readonly trick_winners: readonly number[];
}

/** Eine Karten-Aktion eines bestimmten Sitzes. */
export interface Move {
  readonly seat: number;
  readonly card: Card;
}

/** Strukturiertes Ergebnis einer kompletten Runde. */
export interface RoundScore {
  /** Karten-Punkte pro Team-ID (Index 0 / 1 bei Kreuz-Jass). */
  readonly team_card_points: readonly number[];
  /** Index des Teams, das alle 9 Stiche gemacht hat, oder `null`. */
  readonly matsch_team: number | null;
  /** Sitz-Index pro abgeschlossenem Trick (Länge = 9). */
  readonly trick_winners: readonly number[];
}

// ---------------------------------------------------------------------
// Round-Setup
// ---------------------------------------------------------------------

/** Standard-Sitz/Team-Zuordnung im Kreuz-Jass: Sitz 0+2 vs. 1+3. */
export const DEFAULT_TEAMS: readonly number[] = [0, 1, 0, 1];

interface NewRoundOptions {
  variant: Variant;
  announcement: Announcement;
  /** 4 × 9 Karten (oder generisch num_players × cards_per_player). */
  hands: readonly (readonly Card[])[];
  /** Erster Anspieler. Bei Kreuz-Jass: announcer (oder bei Push: original announcer). */
  starter: number;
  /** Standard [0,1,0,1]. */
  teams?: readonly number[];
  round_idx?: number;
}

export function newRound(opts: NewRoundOptions): RoundState {
  const teams = opts.teams ?? DEFAULT_TEAMS;
  const num_players = opts.hands.length;
  if (num_players !== NUM_PLAYERS) {
    throw new Error(`newRound: erwartet ${NUM_PLAYERS} Hände, bekommen ${num_players}`);
  }
  const expectedPerHand = DECK_SIZE / NUM_PLAYERS;
  for (let i = 0; i < num_players; i++) {
    const h = opts.hands[i] as readonly Card[];
    if (h.length !== expectedPerHand) {
      throw new Error(`newRound: Hand ${i} hat ${h.length} statt ${expectedPerHand} Karten`);
    }
  }
  if (opts.starter < 0 || opts.starter >= num_players) {
    throw new Error(`newRound: starter ${opts.starter} außerhalb 0..${num_players - 1}`);
  }
  const numTeams = new Set(teams).size;
  return {
    variant: opts.variant,
    announcement: opts.announcement,
    teams,
    num_players,
    round_idx: opts.round_idx ?? 0,
    hands: opts.hands.map((h) => [...h]),
    trick_idx: 0,
    current_trick_starter: opts.starter,
    current_trick_cards: [],
    completed_tricks: [],
    team_card_points: new Array<number>(numTeams).fill(0),
    trick_winners: [],
  };
}

/**
 * Welcher Sitz ist als Nächstes dran?
 *
 * Reihenfolge im Stich: starter → starter+1 → starter+2 → starter+3 (mod 4).
 * Wenn der Stich abgeschlossen ist (4 Karten), aber `isRoundDone(state)`
 * noch falsch, hat der Trick-Gewinner den nächsten Anspielzug — diesen Fall
 * gibt es zwischen `applyMove`-Aufrufen aber **nicht**, weil `applyMove` den
 * Trick sofort abschließt und in den nächsten überführt.
 */
export function whoseTurn(state: RoundState): number {
  return (state.current_trick_starter + state.current_trick_cards.length) % state.num_players;
}

/** True wenn alle 9 Tricks gespielt sind. */
export function isRoundDone(state: RoundState): boolean {
  return state.completed_tricks.length >= TRICKS_PER_ROUND;
}

// ---------------------------------------------------------------------
// applyMove
// ---------------------------------------------------------------------

/**
 * Server-autoritative State-Transition für einen Karten-Zug.
 *
 * Wirft `InvalidMoveError` bei:
 *   - Spiel bereits zu Ende
 *   - falscher Spieler am Zug
 *   - Karte nicht in der Hand
 *   - Karte verletzt Farbzwang / Untertrumpfen-Verbot
 *
 * Liefert einen neuen RoundState (Original unverändert).
 */
export function applyMove(state: RoundState, move: Move): RoundState {
  if (isRoundDone(state)) {
    throw new InvalidMoveError("Round is already finished");
  }
  const turn = whoseTurn(state);
  if (move.seat !== turn) {
    throw new InvalidMoveError(`Not seat ${move.seat}'s turn (whose turn: ${turn})`);
  }
  const hand = state.hands[move.seat] as readonly Card[];
  if (!hand.some((c) => cardsEqual(c, move.card))) {
    throw new InvalidMoveError(`Card ${cardToString(move.card)} not in hand of seat ${move.seat}`);
  }
  const legal = legalMoves(hand, state.current_trick_cards, state.variant);
  if (!legal.some((c) => cardsEqual(c, move.card))) {
    throw new InvalidMoveError(
      `Card ${cardToString(move.card)} is not a legal move (variant=${state.variant.mode}` +
        (state.variant.trump_suit ? `, trump=${state.variant.trump_suit}` : "") +
        `)`
    );
  }

  // 1) Karte aus Hand entfernen, in current_trick einreihen.
  const newHands = state.hands.map((h, i) =>
    i === move.seat ? h.filter((c) => !cardsEqual(c, move.card)) : [...h]
  );
  const newTrickCards = [...state.current_trick_cards, move.card];

  // 2) Trick noch nicht voll? → einfach den neuen Zustand zurückgeben.
  if (newTrickCards.length < state.num_players) {
    return {
      ...state,
      hands: newHands,
      current_trick_cards: newTrickCards,
    };
  }

  // 3) Trick voll — Gewinner + Punkte berechnen, completed_tricks anhängen,
  //    nächsten Trick beginnen (oder Runde beenden).
  const winnerIdxInTrick = trickWinner(newTrickCards, state.variant);
  const winnerSeat = (state.current_trick_starter + winnerIdxInTrick) % state.num_players;
  const isLastTrick = state.completed_tricks.length === TRICKS_PER_ROUND - 1;
  const pts = trickPoints(newTrickCards, state.variant, isLastTrick);

  const winnerTeam = state.teams[winnerSeat] as number;
  const newTeamPoints = state.team_card_points.map((p, i) => (i === winnerTeam ? p + pts : p));

  const completed: CompletedTrick = {
    starter: state.current_trick_starter,
    cards: newTrickCards,
  };

  return {
    ...state,
    hands: newHands,
    trick_idx: state.trick_idx + 1,
    current_trick_starter: winnerSeat,
    current_trick_cards: [],
    completed_tricks: [...state.completed_tricks, completed],
    team_card_points: newTeamPoints,
    trick_winners: [...state.trick_winners, winnerSeat],
  };
}

// ---------------------------------------------------------------------
// Final-Score
// ---------------------------------------------------------------------

/**
 * Karten-Punkte pro Team + Matsch-Flag. Setzt voraus, dass die Runde
 * fertig ist.
 *
 * **Matsch-Bonus**: Wenn ein Team alle 9 Stiche gewonnen hat, addieren
 * wir `MATCH_BONUS` (= 100) zu seinen `team_card_points`. Die Konsistenz-
 * Prüfung aus der NN-Spec (`sum(team_card_points) == 157` ohne Matsch,
 * `== 257` mit Matsch) gilt nach diesem Schritt.
 */
export function finalRoundScore(state: RoundState): RoundScore {
  if (!isRoundDone(state)) {
    throw new Error("finalRoundScore: round is not finished yet");
  }
  // Matsch-Team: hat ein Team alle 9 Stiche gewonnen?
  const numTeams = state.team_card_points.length;
  let matsch_team: number | null = null;
  for (let t = 0; t < numTeams; t++) {
    let count = 0;
    for (const w of state.trick_winners) {
      if (state.teams[w] === t) count++;
    }
    if (count === TRICKS_PER_ROUND) {
      matsch_team = t;
      break;
    }
  }

  // Matsch-Bonus direkt in team_card_points einrechnen.
  const team_card_points = [...state.team_card_points];
  if (matsch_team !== null) {
    team_card_points[matsch_team] = (team_card_points[matsch_team] ?? 0) + MATCH_BONUS;
  }

  return {
    team_card_points,
    matsch_team,
    trick_winners: state.trick_winners,
  };
}

// ---------------------------------------------------------------------
// Per-Spieler-Sicht (für Encoder + WS-Push)
// ---------------------------------------------------------------------

/**
 * Wandelt den Server-RoundState in einen `GameState` aus Sicht eines bestimmten
 * Spielers. Andere Hände sind nicht enthalten — diese Funktion ist der Punkt,
 * an dem private Information server-seitig "abgeschnitten" wird, bevor sie an
 * Clients geht.
 *
 * `own_team_score` / `opp_team_score` werden aus `state.team_card_points`
 * abgeleitet (Team des Viewers = own, anderes = opp).
 */
export function viewAsPlayer(state: RoundState, perspectiveSeat: number): GameState {
  const myTeam = state.teams[perspectiveSeat] as number;
  // Bei zwei-Team-Konfiguration: opp = das andere Team. Wir summieren defensiv
  // alle Team-Punkte != myTeam (funktioniert auch für hypothetische Multi-Team).
  let own = 0;
  let opp = 0;
  for (let t = 0; t < state.team_card_points.length; t++) {
    const p = state.team_card_points[t] as number;
    if (t === myTeam) own += p;
    else opp += p;
  }
  return {
    player_idx: perspectiveSeat,
    variant: state.variant,
    announcement: state.announcement,
    current_trick_cards: state.current_trick_cards,
    current_trick_starter: state.current_trick_starter,
    teams: state.teams,
    completed_tricks: state.completed_tricks,
    own_team_score: own,
    opp_team_score: opp,
    round_idx: state.round_idx,
    trick_idx: state.trick_idx,
    num_players: state.num_players,
  };
}

/** Hand eines bestimmten Sitzes (server-intern, nur an den Owner-Client schicken). */
export function handOf(state: RoundState, seat: number): readonly Card[] {
  return state.hands[seat] as readonly Card[];
}

// ---------------------------------------------------------------------
// Deck-Building + Shuffle
// ---------------------------------------------------------------------

/** Standard-RNG, der zufällige Floats in [0, 1) liefert. */
export type RandomFn = () => number;

/**
 * Erzeugt ein frisches 36-Karten-Deck in deterministischer Reihenfolge.
 * Wird mit dem RNG durchmischt und in 4 × 9 Hände aufgeteilt.
 */
export function freshDeck(): Card[] {
  const out: Card[] = new Array(DECK_SIZE);
  for (let s = 0; s < SUITS.length; s++) {
    for (let r = 0; r < RANKS.length; r++) {
      // Cast nötig: SUITS/RANKS sind readonly Tuples mit Index-Signatur Suit/Rank.
      out[s * 9 + r] = { suit: SUITS[s]!, rank: RANKS[r]! };
    }
  }
  return out;
}

/**
 * Fisher-Yates-Shuffle (in-place klon-frei). Pure: nimmt RNG als Argument, damit
 * Tests deterministisch sein können.
 */
export function shuffleDeck(deck: readonly Card[], rng: RandomFn): Card[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as Card;
    arr[i] = arr[j] as Card;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Teilt ein gemischtes Deck in `num_players` Hände zu je 9 Karten.
 * Spielt-Verteilung: Sitz 0 bekommt Karten 0..8, Sitz 1 die 9..17, etc.
 */
export function dealCards(rng: RandomFn, num_players: number = NUM_PLAYERS): Card[][] {
  if (DECK_SIZE % num_players !== 0) {
    throw new Error(`dealCards: ${DECK_SIZE} ist nicht teilbar durch ${num_players}`);
  }
  const shuffled = shuffleDeck(freshDeck(), rng);
  const cardsPerHand = DECK_SIZE / num_players;
  const hands: Card[][] = [];
  for (let p = 0; p < num_players; p++) {
    hands.push(shuffled.slice(p * cardsPerHand, (p + 1) * cardsPerHand));
  }
  return hands;
}

// ---------------------------------------------------------------------
// Helpers / Fehler
// ---------------------------------------------------------------------

export class InvalidMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoveError";
  }
}

function cardToString(card: Card): string {
  return `${card.suit}-${card.rank}`;
}
