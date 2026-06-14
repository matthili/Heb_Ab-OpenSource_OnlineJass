/**
 * **Bodensee-Jass — Round-State + Move-Anwendung.**
 *
 * TS-Port von `jass_engine/bodensee/{deal,round,trick}.py`.
 *
 * Eine Runde: 18 Stiche, 2 Spieler. Pro Zug spielt der Spieler eine Karte
 * aus Hand ODER vom sichtbaren Tisch; eine gespielte Tisch-Karte deckt die
 * verdeckte darunter auf. Keine Weisen, keine Stöcke, kein Schieben.
 */
import { cardsEqual, isWeli } from "../cards.js";
import { trickPoints, trickWinner } from "../rules.js";
import { freshDeck, shuffleDeck, type RandomFn } from "../state.js";
import {
  MATCH_BONUS,
  SACK_MIN_POINTS,
  type Announcement,
  type Card,
  type Variant,
} from "../types.js";
import { cardSource, hiddenTableCount, legalMovesBodensee, visibleTableCards } from "./rules.js";
import {
  BODENSEE_HAND_SIZE,
  BODENSEE_TABLE_STACKS,
  BODENSEE_TRICKS_PER_ROUND,
  type BodenseeEncoderInput,
  type BodenseeGameState,
  type BodenseeMove,
  type BodenseeRoundScore,
  type BodenseeRoundState,
  type TableStack,
} from "./types.js";

/** Fehler bei ungültigem Bodensee-Move (analog `InvalidMoveError`). */
export class InvalidBodenseeMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBodenseeMoveError";
  }
}

// ──────────────────────────────────────────────────────────────────────
// Deal
// ──────────────────────────────────────────────────────────────────────

/**
 * Mischt das 36-Karten-Deck und verteilt im Bodensee-Schema:
 *   Stufe 1 — je 6 Stapel pro Spieler mit einer verdeckten Karte
 *   Stufe 2 — je 6 Handkarten
 *   Stufe 3 — je 6 sichtbare Karten oben auf die Stapel
 * Reihenfolge innerhalb jeder Stufe: abwechselnd Spieler 0, Spieler 1.
 */
export function dealBodensee(rng: RandomFn): {
  hands: Card[][];
  tables: TableStack[][];
} {
  const deck = shuffleDeck(freshDeck(), rng);
  let idx = 0;

  const hands: Card[][] = [[], []];
  // Mutable Tisch-Struktur beim Austeilen.
  const tablesMut: { visible: Card | null; hidden: Card | null }[][] = [[], []];

  // Stufe 1: verdeckte Karten.
  for (let stack = 0; stack < BODENSEE_TABLE_STACKS; stack++) {
    for (let p = 0; p < 2; p++) {
      tablesMut[p]!.push({ visible: null, hidden: deck[idx++] as Card });
    }
  }
  // Stufe 2: Handkarten.
  for (let h = 0; h < BODENSEE_HAND_SIZE; h++) {
    for (let p = 0; p < 2; p++) {
      hands[p]!.push(deck[idx++] as Card);
    }
  }
  // Stufe 3: sichtbare Karten.
  for (let stack = 0; stack < BODENSEE_TABLE_STACKS; stack++) {
    for (let p = 0; p < 2; p++) {
      tablesMut[p]![stack]!.visible = deck[idx++] as Card;
    }
  }
  if (idx !== 36) {
    throw new Error(`dealBodensee: ${idx} Karten verteilt, erwartet 36.`);
  }

  const tables: TableStack[][] = tablesMut.map((t) =>
    t.map((s) => ({ visible: s.visible, hidden: s.hidden }))
  );
  return { hands, tables };
}

/** Spieler-Index, dessen Karten den WELI (Schelle-6) enthalten. */
export function findWeliHolderBodensee(
  hands: readonly (readonly Card[])[],
  tables: readonly (readonly TableStack[])[]
): number {
  for (let p = 0; p < 2; p++) {
    if ((hands[p] ?? []).some((c) => isWeli(c))) return p;
    for (const s of tables[p] ?? []) {
      if ((s.visible && isWeli(s.visible)) || (s.hidden && isWeli(s.hidden))) {
        return p;
      }
    }
  }
  throw new Error("dealBodensee: WELI nicht im Deck gefunden.");
}

// ──────────────────────────────────────────────────────────────────────
// Slalom: effektive Variante pro Stich
// ──────────────────────────────────────────────────────────────────────

/**
 * Effektive Variante für einen Stich. Bei Slalom alterniert der Modus
 * pro Stich, beginnend mit dem angesagten Startmodus (OBEN oder UNTEN).
 */
export function bodenseeEffectiveVariant(ann: Announcement, trickIdx: number): Variant {
  if (!ann.slalom) return ann.variant;
  const start = ann.variant.mode;
  const flipped = start === "OBEN" ? "UNTEN" : "OBEN";
  return { mode: trickIdx % 2 === 0 ? start : flipped };
}

// ──────────────────────────────────────────────────────────────────────
// Round-Setup
// ──────────────────────────────────────────────────────────────────────

interface NewBodenseeRoundOptions {
  announcement: Announcement;
  hands: readonly (readonly Card[])[];
  tables: readonly (readonly TableStack[])[];
  /** Wer spielt den ersten Stich an + hat angesagt (= WELI-Halter). */
  announcerIdx: number;
  roundIdx?: number;
  /** Tisch-Option „Sack": < SACK_MIN_POINTS Kartenpunkte → nichts gewertet. */
  sackRule?: boolean;
}

export function newBodenseeRound(opts: NewBodenseeRoundOptions): BodenseeRoundState {
  const roundIdx = opts.roundIdx ?? 0;
  return {
    variant: bodenseeEffectiveVariant(opts.announcement, 0),
    announcement: opts.announcement,
    hands: opts.hands.map((h) => [...h]),
    tables: opts.tables.map((t) => t.map((s) => ({ ...s }))),
    current_trick_cards: [],
    current_trick_starter: opts.announcerIdx,
    completed_tricks: [],
    trick_winners: [],
    player_card_points: [0, 0],
    announcer_idx: opts.announcerIdx,
    round_idx: roundIdx,
    trick_idx: 0,
    sack_rule: opts.sackRule ?? false,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Turn-Order
// ──────────────────────────────────────────────────────────────────────

/** Wer ist am Zug? Bei leerem Stich der Starter, sonst der andere. */
export function whoseTurnBodensee(state: BodenseeRoundState): number {
  if (state.current_trick_cards.length === 0) return state.current_trick_starter;
  return 1 - state.current_trick_starter;
}

export function isBodenseeRoundDone(state: BodenseeRoundState): boolean {
  return state.completed_tricks.length >= BODENSEE_TRICKS_PER_ROUND;
}

// ──────────────────────────────────────────────────────────────────────
// applyMove
// ──────────────────────────────────────────────────────────────────────

/** Entfernt `card` aus Hand oder Tisch und liefert die neuen Strukturen. */
function removeBodenseeCard(
  hand: readonly Card[],
  table: readonly TableStack[],
  card: Card
): { hand: Card[]; table: TableStack[] } {
  const source = cardSource(hand, table, card);
  if (source === "hand") {
    return {
      hand: hand.filter((c) => !cardsEqual(c, card)),
      table: table.map((s) => ({ ...s })),
    };
  }
  // table: visible spielen → hidden rückt nach (oder Stapel wird leer).
  const newTable = table.map((s) => {
    if (s.visible !== null && cardsEqual(s.visible, card)) {
      return { visible: s.hidden, hidden: null };
    }
    return { ...s };
  });
  return { hand: [...hand], table: newTable };
}

/**
 * Wendet einen Bodensee-Move an. Validiert Reihenfolge + Legalität,
 * wirft `InvalidBodenseeMoveError` bei Verstoß (State bleibt unverändert).
 */
export function applyBodenseeMove(
  state: BodenseeRoundState,
  move: BodenseeMove
): BodenseeRoundState {
  if (isBodenseeRoundDone(state)) {
    throw new InvalidBodenseeMoveError("Runde ist bereits beendet.");
  }
  const turn = whoseTurnBodensee(state);
  if (move.player !== turn) {
    throw new InvalidBodenseeMoveError(
      `Spieler ${move.player} ist nicht am Zug (aktuell: ${turn}).`
    );
  }
  const hand = state.hands[move.player] ?? [];
  const table = state.tables[move.player] ?? [];
  const legal = legalMovesBodensee(hand, table, state.current_trick_cards, state.variant);
  if (!legal.some((c) => cardsEqual(c, move.card))) {
    throw new InvalidBodenseeMoveError(
      `Karte ${move.card.suit}-${move.card.rank} ist kein legaler Zug.`
    );
  }

  // Karte aus dem Spieler-Zustand entfernen.
  const { hand: newHand, table: newTable } = removeBodenseeCard(hand, table, move.card);
  const newHands = state.hands.map((h, i) => (i === move.player ? newHand : [...h]));
  const newTables = state.tables.map((t, i) =>
    i === move.player ? newTable : t.map((s) => ({ ...s }))
  );

  const trickCards = [...state.current_trick_cards, move.card];

  // Stich noch nicht voll (erst 1 Karte) → nur Karte ablegen.
  if (trickCards.length < 2) {
    return {
      ...state,
      hands: newHands,
      tables: newTables,
      current_trick_cards: trickCards,
    };
  }

  // Stich voll → auswerten.
  const winnerInTrick = trickWinner(trickCards, state.variant);
  // trickCards[0] gehört dem Starter, trickCards[1] dem anderen.
  const winnerSeat =
    winnerInTrick === 0 ? state.current_trick_starter : 1 - state.current_trick_starter;
  const isLast = state.completed_tricks.length + 1 >= BODENSEE_TRICKS_PER_ROUND;
  const pts = trickPoints(trickCards, state.variant, isLast);

  const newPoints = state.player_card_points.map((p, i) => (i === winnerSeat ? p + pts : p));
  const newTrickIdx = state.trick_idx + 1;

  return {
    ...state,
    hands: newHands,
    tables: newTables,
    current_trick_cards: [],
    current_trick_starter: winnerSeat,
    completed_tricks: [
      ...state.completed_tricks,
      { starter: state.current_trick_starter, cards: trickCards },
    ],
    trick_winners: [...state.trick_winners, winnerSeat],
    player_card_points: newPoints,
    trick_idx: newTrickIdx,
    // Effektive Variante für den nächsten Stich (Slalom alterniert).
    variant: bodenseeEffectiveVariant(state.announcement, newTrickIdx),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Score
// ──────────────────────────────────────────────────────────────────────

/** Karten-Punkte je Spieler + Matsch-Bonus. Setzt eine fertige Runde voraus. */
export function finalBodenseeScore(state: BodenseeRoundState): BodenseeRoundScore {
  if (!isBodenseeRoundDone(state)) {
    throw new Error("finalBodenseeScore: Runde ist nicht beendet.");
  }
  let matsch_player: number | null = null;
  for (let p = 0; p < 2; p++) {
    const won = state.trick_winners.filter((w) => w === p).length;
    if (won === BODENSEE_TRICKS_PER_ROUND) {
      matsch_player = p;
      break;
    }
  }
  // „Sack" (Tisch-Option): Spieler mit < SACK_MIN_POINTS Kartenpunkten bekommt
  // GAR NICHTS gewertet (verfällt, kein Transfer). Pro Runde kann höchstens
  // einer betroffen sein — die Gesamtpunkte (157) heben den anderen klar drüber.
  const sackRule = state.sack_rule === true;
  const voided: { player: number; cardPoints: number }[] = [];
  const player_total_points = state.player_card_points.map((cardPts, p) => {
    if (sackRule && cardPts < SACK_MIN_POINTS) {
      voided.push({ player: p, cardPoints: cardPts });
      return 0;
    }
    return p === matsch_player ? cardPts + MATCH_BONUS : cardPts;
  });
  return {
    player_total_points,
    matsch_player,
    trick_winners: state.trick_winners,
    ...(voided.length > 0 ? { voided } : {}),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Per-Spieler-Sicht
// ──────────────────────────────────────────────────────────────────────

/** Hand eines Spielers (server-intern). */
export function bodenseeHandOf(state: BodenseeRoundState, seat: number): readonly Card[] {
  return state.hands[seat] ?? [];
}

/** Tisch eines Spielers (server-intern). */
export function bodenseeTableOf(state: BodenseeRoundState, seat: number): readonly TableStack[] {
  return state.tables[seat] ?? [];
}

/**
 * Per-Spieler-Sicht — entfernt private Information (fremde Hand, alle
 * verdeckten Karten).
 */
export function bodenseeViewAsPlayer(state: BodenseeRoundState, seat: number): BodenseeGameState {
  const oppSeat = 1 - seat;
  const oppTable = state.tables[oppSeat] ?? [];
  const ownTable = state.tables[seat] ?? [];
  return {
    player_idx: seat,
    variant: state.variant,
    announcement: state.announcement,
    current_trick_cards: state.current_trick_cards,
    current_trick_starter: state.current_trick_starter,
    completed_tricks: state.completed_tricks,
    opponent_visible_table: visibleTableCards(oppTable),
    opponent_hand_count: (state.hands[oppSeat] ?? []).length,
    opponent_hidden_table_count: hiddenTableCount(oppTable),
    own_hidden_table_count: hiddenTableCount(ownTable),
    own_score: state.player_card_points[seat] ?? 0,
    opp_score: state.player_card_points[oppSeat] ?? 0,
    round_idx: state.round_idx,
    trick_idx: state.trick_idx,
  };
}

/**
 * Baut die vollständige Encoder-Eingabe für einen Sitz. Brücke zwischen
 * dem server-internen `BodenseeRoundState` und dem `encodeBodenseeState`-
 * Input (das exakt dem Fixture-Format entspricht).
 */
export function bodenseeEncoderInput(
  state: BodenseeRoundState,
  seat: number
): BodenseeEncoderInput {
  const view = bodenseeViewAsPlayer(state, seat);
  const ownTable = state.tables[seat] ?? [];
  return {
    hand: state.hands[seat] ?? [],
    own_table: ownTable.map((s) => ({
      visible: s.visible,
      has_hidden: s.hidden !== null,
    })),
    variant_effective: state.variant,
    announcement: state.announcement,
    current_trick_cards: view.current_trick_cards,
    current_trick_starter: view.current_trick_starter,
    player_idx: seat,
    completed_tricks: view.completed_tricks,
    opponent_visible_table: view.opponent_visible_table,
    opponent_hand_count: view.opponent_hand_count,
    opponent_hidden_table_count: view.opponent_hidden_table_count,
    own_hidden_table_count: view.own_hidden_table_count,
    own_score: view.own_score,
    opp_score: view.opp_score,
    round_idx: state.round_idx,
    trick_idx: state.trick_idx,
    i_am_announcer: state.announcer_idx === seat,
  };
}
