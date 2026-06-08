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
 */

import { cardsEqual } from "./cards.js";
import { legalMoves, trickPoints, trickWinner } from "./rules.js";
import { aggregateWeisen, validateDeclaration, type WeisDeclaration } from "./weisen.js";
import {
  type Announcement,
  type Card,
  type CompletedTrick,
  type GameState,
  type Variant,
  MATCH_BONUS,
  STOECK_BONUS,
  SACK_MIN_POINTS,
  NUM_PLAYERS,
  TRICKS_PER_ROUND,
  DECK_SIZE,
  RANKS,
  SUITS,
} from "./types.js";

/**
 * Effektive Variante für einen Stich. Bei **Slalom** alterniert der Modus pro
 * Stich, beginnend mit dem angesagten Startmodus (OBEN oder UNTEN): Stich 0 =
 * Start, Stich 1 = geflippt, Stich 2 = Start, … Ohne Slalom ist es immer die
 * angesagte Variante. (4-Spieler-Pendant zu `bodenseeEffectiveVariant`.)
 */
export function effectiveVariant(ann: Announcement, trickIdx: number): Variant {
  if (!ann.slalom) return ann.variant;
  const start = ann.variant.mode;
  const flipped = start === "OBEN" ? "UNTEN" : "OBEN";
  return { mode: trickIdx % 2 === 0 ? start : flipped };
}

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

  // ── Stöck (Vorarlberger Kreuz-Jass) ──────────────────────────────
  // **Stöck**: Wenn ein Spieler in einem TRUMPF/GUMPF-Spiel beide Karten
  // Trumpf-OBER + Trumpf-KOENIG auf der Hand hatte, darf er nach dem
  // Ausspielen der zweiten der beiden Karten „Stöck" rufen — Team
  // bekommt +20 Punkte. Nicht ansagen → keine Punkte.
  //
  // `stoeck_eligible_seat`: Sitz, der gerade jetzt rufen darf (= hat die
  // zweite der beiden Karten zuletzt gespielt). Bleibt gesetzt bis er
  // entweder ruft (→ `stoeck_announced_team` gesetzt, eligible-Feld
  // zurück auf null) oder seine **nächste** Karte spielt (Frist verstrichen).
  readonly stoeck_eligible_seat: number | null;
  // Wenn nicht-null: Team-ID, das Stöck offiziell angesagt hat. +20
  // werden in `finalRoundScore` addiert. Pro Runde nur einmal möglich
  // (es kann maximal einen Stöck-Inhaber geben).
  readonly stoeck_announced_team: number | null;

  // ── Weisen (Vorarlberger Kreuz-Jass) ──────────────────────────────
  // **Weisen** = Sequenzen + Vier-Gleiche, die ein Spieler im ersten
  // Spiel (= Trick 1) ausweisen darf. Nach Trick 1 wird das höchste
  // Weis pro Team verglichen, das Sieger-Team kassiert ALLE eigenen
  // Weisen-Punkte. Verlierer kriegt nichts (auch wenn er aufsummiert
  // mehr Weisen hatte).
  //
  // Lifecycle pro Spieler:
  //   1. PENDING (default) — Button noch nicht geklickt, Fenster noch offen
  //   2. OPEN — Button geklickt, kann jetzt Karten ausweisen
  //   3. SUBMITTED — Karten finalisiert
  //   4. MISSED — Window zu, kein Button geklickt → kein Weis
  //
  // `weisen_button_clicked_at[seat]`: Timestamp (oder null wenn nicht
  //   geklickt). Wir tracken den Zeitpunkt, weil das Frontend die
  //   "OPEN"-Phase daran erkennt + ein konsistentes State-Modell hat.
  // `weisen_declarations[seat]`: Liste der submitted Deklarationen.
  //   Leer = nichts ausgewiesen. Mehrere = Spieler hat mehrere Weisen
  //   (z.B. 4 Buur + 3-Blatt) — Karten müssen disjunkt sein.
  // `weisen_evaluated`: True ab dem Moment, in dem nach Trick 1 die
  //   Aggregation gelaufen ist + Punkte zu team_card_points addiert
  //   wurden. Verhindert doppelte Auswertung.
  readonly weisen_button_clicked_at: readonly (number | null)[];
  readonly weisen_declarations: readonly (readonly WeisDeclaration[])[];
  readonly weisen_evaluated: boolean;

  // ── Optionale Wertungs-Regeln (Tisch-Optionen) ────────────────────
  // Pro Team in der Trick-1-Auswertung kassierte Weis-Punkte (Delta).
  // Getrennt geführt, damit `finalRoundScore` Karten- von Weis-Punkten
  // unterscheiden kann (für die Regeln unten). `undefined` = Alt-State
  // (Redis vor Deploy) → wird als „kein Weis" behandelt.
  readonly weisen_team_points?: readonly number[] | undefined;
  // „Sack": Team/Spieler mit < 21 Kartenpunkten (aus Stichen) bekommt
  // gar nichts gewertet — Kartenpunkte UND Weis verfallen (kein Transfer).
  readonly sack_rule?: boolean | undefined;
  // „Kein Stich → Weis verfällt": wer keinen einzigen Stich macht,
  // verliert am Rundenende seine Weis-Punkte wieder.
  readonly weis_needs_trick?: boolean | undefined;
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

/**
 * Sitz/Team-Zuordnung im Solo-Jass: jeder Spieler ist sein eigenes Team.
 * Damit verteilt die team-agnostische Punkte-/Weisen-/Matsch-Aggregation
 * automatisch pro Spieler statt pro Paar.
 */
export const SOLO_TEAMS: readonly number[] = [0, 1, 2, 3];

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
  /** Tisch-Option „Sack": < 21 Kartenpunkte → nichts gewertet. Default false. */
  sackRule?: boolean;
  /** Tisch-Option „kein Stich → Weis verfällt". Default false. */
  weisNeedsTrick?: boolean;
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
    stoeck_eligible_seat: null,
    stoeck_announced_team: null,
    weisen_button_clicked_at: new Array<number | null>(num_players).fill(null),
    weisen_declarations: Array.from({ length: num_players }, () => [] as WeisDeclaration[]),
    weisen_evaluated: false,
    weisen_team_points: new Array<number>(numTeams).fill(0),
    sack_rule: opts.sackRule ?? false,
    weis_needs_trick: opts.weisNeedsTrick ?? false,
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

  // 1a) Stöck-Lifecycle.
  //
  //   - Zuerst: Wenn der gerade ziehende Sitz `stoeck_eligible_seat`
  //     **schon vorher** war, hat er die Frist verpasst (er zieht
  //     ein nächstes Mal ohne Ansage) → eligible löschen.
  //   - Dann: Wenn dieser Zug die **zweite** der beiden Stöck-Karten
  //     ist (Spieler hat die andere bereits in einem früheren Trick
  //     gespielt — denn Karten wechseln nicht den Besitzer), wird er
  //     neu eligible — sofern Stöck noch nicht angesagt wurde.
  let nextStoeckEligible: number | null =
    state.stoeck_eligible_seat === move.seat ? null : state.stoeck_eligible_seat;
  const mode = state.variant.mode;
  const trumpSuit = state.variant.trump_suit;
  if (
    (mode === "TRUMPF" || mode === "GUMPF") &&
    trumpSuit !== undefined &&
    state.stoeck_announced_team === null &&
    move.card.suit === trumpSuit &&
    (move.card.rank === "OBER" || move.card.rank === "KOENIG")
  ) {
    const otherRank: "OBER" | "KOENIG" = move.card.rank === "OBER" ? "KOENIG" : "OBER";
    // Hat dieser Sitz die andere Stöck-Karte bereits in einem früheren
    // Trick gespielt? Karten wandern nicht — also impliziert „selber
    // gespielt" auch „selber gehabt".
    const playedOtherBefore = state.completed_tricks.some((tr) => {
      // Spieler-Sitz bestimmen: starter + position-in-trick
      return tr.cards.some((card, idxInTrick) => {
        const playerSeat = (tr.starter + idxInTrick) % state.num_players;
        return playerSeat === move.seat && card.suit === trumpSuit && card.rank === otherRank;
      });
    });
    // Auch im laufenden Trick prüfen (falls eine Karte in 2 aufeinander-
    // folgenden Stichen gehört — unmöglich, weil seat nur einmal pro
    // Trick zieht; daher reicht completed_tricks).
    if (playedOtherBefore) {
      nextStoeckEligible = move.seat;
    }
  }

  // 2) Trick noch nicht voll? → einfach den neuen Zustand zurückgeben.
  if (newTrickCards.length < state.num_players) {
    return {
      ...state,
      hands: newHands,
      current_trick_cards: newTrickCards,
      stoeck_eligible_seat: nextStoeckEligible,
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

  // Weisen-Evaluation: gerade-eben Trick 1 abgeschlossen (completed_tricks
  // hatte 0 Einträge, jetzt nach dem return wären es 1). Wenn noch nicht
  // evaluiert, jetzt aggregieren + Punkte ans Sieger-Team addieren.
  let weisenEvaluated = state.weisen_evaluated;
  let teamPointsAfterWeisen = newTeamPoints;
  let weisenTeamPoints = state.weisen_team_points;
  if (!state.weisen_evaluated && state.completed_tricks.length === 0) {
    // state.completed_tricks.length === 0 vor diesem Trick → das hier ist
    // der gerade abgeschlossene Trick 1.
    weisenEvaluated = true;
    teamPointsAfterWeisen = applyWeisenPoints(state, newTeamPoints);
    // Reiner Weis-Anteil pro Team = Differenz zu den Karten-Punkten vor
    // der Auswertung. Damit kann finalRoundScore Karten- von Weis-Punkten
    // trennen (für die „Sack"- und „kein Stich"-Regeln).
    weisenTeamPoints = teamPointsAfterWeisen.map((p, t) => p - (newTeamPoints[t] ?? 0));
  }

  return {
    ...state,
    hands: newHands,
    trick_idx: state.trick_idx + 1,
    // Bei Slalom alterniert die effektive Variante pro Stich — den nächsten
    // Stich auf die (ggf. geflippte) Variante setzen, sonst bliebe der
    // Startmodus stehen und der Stich würde falsch ausgewertet (Gewinner +
    // Punkte). Ohne Slalom unverändert.
    variant: state.announcement.slalom
      ? effectiveVariant(state.announcement, state.trick_idx + 1)
      : state.variant,
    current_trick_starter: winnerSeat,
    current_trick_cards: [],
    completed_tricks: [...state.completed_tricks, completed],
    team_card_points: teamPointsAfterWeisen,
    trick_winners: [...state.trick_winners, winnerSeat],
    stoeck_eligible_seat: nextStoeckEligible,
    weisen_evaluated: weisenEvaluated,
    weisen_team_points: weisenTeamPoints,
  };
}

/**
 * Aggregiert die submitten Weisen nach Trick 1 und gibt die neue
 * `team_card_points`-Liste mit den Weisen-Punkten ans Sieger-Team
 * addiert zurück. Verlierer kriegt nichts.
 */
function applyWeisenPoints(state: RoundState, baseTeamPoints: readonly number[]): number[] {
  const declarationsPerSeat: Record<number, readonly WeisDeclaration[]> = {};
  for (let seat = 0; seat < state.num_players; seat++) {
    const decls = state.weisen_declarations[seat] ?? [];
    if (decls.length > 0) declarationsPerSeat[seat] = decls;
  }
  // Vorhand = Anspieler des ersten Tricks (= initialer current_trick_starter
  // im allerersten Trick). Da der Trick 1 gerade abgeschlossen ist, ist
  // diese Information im allerersten completed_trick (= der gerade
  // hinzugefügte, aber NOCH nicht im state.completed_tricks-Array).
  // Workaround: wir wissen, dass der initiale Anspieler bei Round-Start
  // im allerersten Trick gespielt hat. `trick_winners`-Array ist noch
  // leer; current_trick_starter (vor diesem applyMove) war der Anspieler
  // des Trick-1-Starts NUR wenn keine completed_tricks existierten.
  const vorhandSeat = state.current_trick_starter;
  const result = aggregateWeisen({
    declarationsPerSeat,
    teams: state.teams,
    trumpSuit: state.variant.trump_suit ?? null,
    vorhandSeat,
    numPlayers: state.num_players,
  });
  if (result.winningTeam === null || result.points === 0) return [...baseTeamPoints];
  return baseTeamPoints.map((p, t) => (t === result.winningTeam ? p + result.points : p));
}

// ---------------------------------------------------------------------
// Weisen-Aktionen
// ---------------------------------------------------------------------

/**
 * Status eines Sitzes bzgl. Weisen — UI- + Logik-Hilfsfunktion.
 *
 *   - "PENDING"    Fenster offen, Button noch nicht geklickt.
 *   - "OPEN"       Button geklickt, Karten-Auswahl möglich.
 *   - "SUBMITTED"  Karten abgegeben.
 *   - "MISSED"     Fenster zu, kein Button-Click — kein Weis mehr möglich.
 *   - "EVALUATED"  Trick 1 ist durch + Auswertung gelaufen.
 */
export type WeisenSeatStatus = "PENDING" | "OPEN" | "SUBMITTED" | "MISSED" | "EVALUATED";

/**
 * Wann ist das Weisen-Window für einen Sitz noch offen?
 *
 *   - **Trick 1 muss noch laufen** (completed_tricks.length === 0).
 *   - **Wenn der Sitz im aktuellen Trick noch nicht gespielt hat**:
 *     Window offen.
 *   - **Wenn der Sitz im aktuellen Trick gespielt hat**: Window offen,
 *     solange der **direkte Nachfolger im UZS** noch nicht gespielt hat.
 */
export function weisenWindowOpen(state: RoundState, seat: number): boolean {
  if (state.weisen_evaluated) return false;
  if (state.completed_tricks.length > 0) return false; // Trick 1 schon vorbei

  // Hat der Sitz im aktuellen Trick schon gespielt?
  const positionInTrick =
    (((seat - state.current_trick_starter) % state.num_players) + state.num_players) %
    state.num_players;
  const myCardPlayed = positionInTrick < state.current_trick_cards.length;
  if (!myCardPlayed) return true;

  // Hat der direkte Nachfolger im aktuellen Trick schon gespielt?
  const nextPosition = positionInTrick + 1;
  const nextPlayed = nextPosition < state.current_trick_cards.length;
  return !nextPlayed;
}

export function weisenSeatStatus(state: RoundState, seat: number): WeisenSeatStatus {
  if (state.weisen_evaluated) return "EVALUATED";
  const submitted = (state.weisen_declarations[seat] ?? []).length > 0;
  if (submitted) return "SUBMITTED";
  const buttonClicked = state.weisen_button_clicked_at[seat] !== null;
  if (buttonClicked) return "OPEN";
  if (weisenWindowOpen(state, seat)) return "PENDING";
  return "MISSED";
}

/**
 * Sitz klickt den Weisen-Button — Selection-Mode öffnet sich. Validation:
 * Window muss offen sein UND Sitz noch nicht geklickt haben.
 */
export function clickWeisenButton(
  state: RoundState,
  seat: number,
  timestamp: number = Date.now()
): RoundState {
  if (state.weisen_evaluated) {
    throw new InvalidMoveError("Weisen-Phase ist vorbei");
  }
  if (state.weisen_button_clicked_at[seat] !== null) {
    throw new InvalidMoveError(`Sitz ${seat} hat den Weisen-Button schon geklickt`);
  }
  if (!weisenWindowOpen(state, seat)) {
    throw new InvalidMoveError(`Sitz ${seat}: Weisen-Window ist nicht (mehr) offen — zu spät`);
  }
  const next = [...state.weisen_button_clicked_at];
  next[seat] = timestamp;
  return { ...state, weisen_button_clicked_at: next };
}

/**
 * Sitz reicht seine Weis-Deklarationen ein. Mehrere Weisen pro Sitz
 * sind erlaubt (z.B. 4 Buur + 3-Blatt), aber die Karten ALLER
 * Deklarationen müssen disjunkt sein (keine Karte doppelt verwenden).
 *
 * Erlaubt **so lange `weisen_evaluated === false`** — auch wenn der
 * direkte Nachfolger schon gespielt hat. Voraussetzung: der Sitz muss
 * den Button geklickt haben, BEVOR das Window-Geschlossen-Kriterium
 * griff (= state.weisen_button_clicked_at[seat] !== null).
 */
export function submitWeisen(
  state: RoundState,
  seat: number,
  declarations: readonly WeisDeclaration[]
): RoundState {
  if (state.weisen_evaluated) {
    throw new InvalidMoveError("Weisen-Phase ist vorbei");
  }
  if (state.weisen_button_clicked_at[seat] === null) {
    throw new InvalidMoveError(
      `Sitz ${seat} muss erst den Weisen-Button drücken, bevor er ausweisen kann`
    );
  }
  if ((state.weisen_declarations[seat] ?? []).length > 0) {
    throw new InvalidMoveError(`Sitz ${seat} hat schon ausgewiesen`);
  }

  // Wir validieren die Deklarationen NICHT noch einmal hier (das hat
  // der Caller mit validateDeclaration(...) bereits getan), prüfen aber:
  //   1. Karten-Disjunktheit zwischen den Deklarationen
  //   2. Plausibilität (Punkte > 0)
  const seenCards = new Set<string>();
  for (const decl of declarations) {
    if (decl.points <= 0) {
      throw new InvalidMoveError("Deklaration mit Punkten <= 0");
    }
    for (const c of decl.cards) {
      const key = `${c.suit}-${c.rank}`;
      if (seenCards.has(key)) {
        throw new InvalidMoveError(
          "Karten in mehreren Weisen verwendet — Deklarationen müssen disjunkt sein"
        );
      }
      seenCards.add(key);
    }
  }
  // Außerdem: prüfen, dass alle Karten der Deklarationen zur Original-
  // Hand des Sitzes gehören. Die Original-Hand kennen wir nicht mehr
  // direkt (state.hands wurde durch applyMove dezimiert), aber wir
  // können sie rekonstruieren: aktuelle Hand + alle bisher gespielten
  // Karten dieses Sitzes.
  const originalHand: Card[] = [...state.hands[seat]!];
  for (const tr of state.completed_tricks) {
    const idx = (((seat - tr.starter) % state.num_players) + state.num_players) % state.num_players;
    const playedCard = tr.cards[idx];
    if (playedCard) originalHand.push(playedCard);
  }
  // Für den aktuellen, noch nicht-vollen Trick:
  const posInCurrentTrick =
    (((seat - state.current_trick_starter) % state.num_players) + state.num_players) %
    state.num_players;
  if (posInCurrentTrick < state.current_trick_cards.length) {
    originalHand.push(state.current_trick_cards[posInCurrentTrick]!);
  }
  for (const decl of declarations) {
    for (const c of decl.cards) {
      if (!originalHand.some((h) => cardsEqual(h, c))) {
        throw new InvalidMoveError(
          `Weis enthält Karte ${c.suit}-${c.rank}, die der Sitz ${seat} nicht in seiner Hand hatte`
        );
      }
    }
  }

  // Re-Validate jeder Deklaration gegen die Original-Hand
  for (const decl of declarations) {
    const v = validateDeclaration(decl.cards, originalHand);
    if ("invalid" in v) {
      throw new InvalidMoveError(`Weis ungültig: ${v.reason}`);
    }
    if (v.points !== decl.points || v.kind !== decl.kind) {
      throw new InvalidMoveError("Weis-Deklaration weicht von Re-Validation ab");
    }
  }

  const nextDecls = state.weisen_declarations.map((d, i) =>
    i === seat ? [...declarations] : [...d]
  );
  return { ...state, weisen_declarations: nextDecls };
}

/**
 * Spieler sagt offiziell „Stöck" an. Nur erlaubt wenn `seat ===
 * state.stoeck_eligible_seat`. Sets `stoeck_announced_team` auf das
 * Team des Sitzes, clears `stoeck_eligible_seat`.
 */
export function announceStoeck(state: RoundState, seat: number): RoundState {
  if (state.stoeck_announced_team !== null) {
    throw new InvalidMoveError("Stöck wurde bereits angesagt");
  }
  if (state.stoeck_eligible_seat !== seat) {
    throw new InvalidMoveError(
      `Sitz ${seat} darf gerade keinen Stöck ansagen (eligible: ${state.stoeck_eligible_seat})`
    );
  }
  const team = state.teams[seat];
  if (team === undefined) {
    throw new InvalidMoveError(`Sitz ${seat} hat kein gültiges Team`);
  }
  return {
    ...state,
    stoeck_eligible_seat: null,
    stoeck_announced_team: team,
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
 * `== 257` mit Matsch) gilt nach diesem Schritt — **sofern keine
 * optionalen Regeln aktiv sind** (die dürfen Punkte verfallen lassen).
 *
 * **Optionale Tisch-Regeln** (aus dem RoundState):
 *   - `weis_needs_trick`: Ein Team/Spieler ohne einen einzigen Stich
 *     verliert seine Weis-Punkte wieder (Weis zählt nur mit Stich).
 *   - `sack_rule` („Sack"): Wer unter `SACK_MIN_POINTS` (21) reine
 *     Kartenpunkte aus Stichen bleibt, bekommt GAR NICHTS gewertet —
 *     Kartenpunkte UND Weis verfallen und gehen an niemanden (kein
 *     Transfer ans andere Team).
 */
export function finalRoundScore(state: RoundState): RoundScore {
  if (!isRoundDone(state)) {
    throw new Error("finalRoundScore: round is not finished yet");
  }
  const numTeams = state.team_card_points.length;

  // Stiche pro Team zählen — für Matsch UND die „kein Stich"-Regel.
  const trickCount = new Array<number>(numTeams).fill(0);
  for (const w of state.trick_winners) {
    const tm = state.teams[w];
    if (tm !== undefined && tm < numTeams) trickCount[tm] = (trickCount[tm] ?? 0) + 1;
  }

  // Matsch-Team: hat ein Team alle 9 Stiche gewonnen?
  let matsch_team: number | null = null;
  for (let t = 0; t < numTeams; t++) {
    if (trickCount[t] === TRICKS_PER_ROUND) {
      matsch_team = t;
      break;
    }
  }

  const weisPerTeam = state.weisen_team_points ?? new Array<number>(numTeams).fill(0);
  const sackRule = state.sack_rule === true;
  const weisNeedsTrick = state.weis_needs_trick === true;

  const team_card_points = state.team_card_points.map((merged, t) => {
    // `merged` = Karten-Punkte aus Stichen (inkl. Letzter-Stich-Bonus)
    //            + bereits einaddierte Weis-Punkte.
    const weis = weisPerTeam[t] ?? 0;
    const cardOnly = merged - weis; // reine Stich-Kartenpunkte
    let total = merged;

    // Regel: kein Stich → Weis verfällt.
    if (weisNeedsTrick && (trickCount[t] ?? 0) === 0) total -= weis;

    // Matsch-Bonus (+100). Das Matsch-Team hat 9 Stiche → cardOnly weit
    // über der Sack-Grenze, also nie betroffen.
    if (t === matsch_team) total += MATCH_BONUS;
    // Stöck-Bonus (+20) nur fürs offiziell ansagende Team.
    if (state.stoeck_announced_team === t) total += STOECK_BONUS;

    // Regel „Sack": unter 21 reinen Kartenpunkten verfällt ALLES
    // (Karten + Weis + evtl. Stöck) — geht an niemanden.
    if (sackRule && cardOnly < SACK_MIN_POINTS) total = 0;

    return total;
  });

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
    // Volles Punkte-Array — für das Solo-Scoreboard (4 Einzelkonten).
    team_card_points: state.team_card_points,
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
 * **Abheben** (cut the deck). Schneidet das (bereits gemischte) Deck an
 * Position `cutIndex` ab und legt den oberen Teil unter den unteren:
 * `neu = deck[cutIndex..] + deck[0..cutIndex-1]`.
 *
 * Beispiel `cutIndex = 16`: das neue Deck beginnt mit der bisherigen Karte
 * an Index 16, danach folgen die ersten 16 Karten.
 *
 * `cutIndex` wird modulo Deckgröße normalisiert; **0** (bzw. ein Vielfaches
 * der Deckgröße) lässt die Reihenfolge unverändert = „Klopfen" (nicht
 * abheben, dem Geber vertrauen). Rein deterministisch — der eigentliche
 * Zufall steckt schon im vorherigen `shuffleDeck`.
 */
export function cutDeck(deck: readonly Card[], cutIndex: number): Card[] {
  const n = deck.length;
  if (n === 0) return [];
  const k = ((Math.trunc(cutIndex) % n) + n) % n; // 0..n-1 (0 = Klopfen)
  return [...deck.slice(k), ...deck.slice(0, k)];
}

/**
 * Teilt ein bereits vorbereitetes (gemischtes + ggf. abgehobenes) Deck in
 * `num_players` Hände auf. Sitz 0 bekommt Karten 0..8, Sitz 1 die 9..17, etc.
 */
export function dealFromDeck(deck: readonly Card[], num_players: number = NUM_PLAYERS): Card[][] {
  if (deck.length % num_players !== 0) {
    throw new Error(`dealFromDeck: ${deck.length} ist nicht teilbar durch ${num_players}`);
  }
  const cardsPerHand = deck.length / num_players;
  const hands: Card[][] = [];
  for (let p = 0; p < num_players; p++) {
    hands.push([...deck.slice(p * cardsPerHand, (p + 1) * cardsPerHand)]);
  }
  return hands;
}

/**
 * Teilt ein frisch gemischtes Deck in `num_players` Hände zu je 9 Karten.
 * Spielt-Verteilung: Sitz 0 bekommt Karten 0..8, Sitz 1 die 9..17, etc.
 */
export function dealCards(rng: RandomFn, num_players: number = NUM_PLAYERS): Card[][] {
  if (DECK_SIZE % num_players !== 0) {
    throw new Error(`dealCards: ${DECK_SIZE} ist nicht teilbar durch ${num_players}`);
  }
  return dealFromDeck(shuffleDeck(freshDeck(), rng), num_players);
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
