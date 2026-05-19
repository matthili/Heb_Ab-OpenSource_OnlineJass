/**
 * **Weisen-Logik** — Pure Functions zum Erkennen, Validieren und
 * Vergleichen von Weisen-Deklarationen.
 *
 * Ein „Weis" ist eine Karten-Kombination in der Hand eines Spielers,
 * die er vor / während des ersten Spiels (= erster Trick) ausweisen
 * darf. Nach Abschluss des ersten Spiels wird das *höchste* Weis pro
 * Team bestimmt — und *nur das Sieger-Team* kassiert ALLE eigenen
 * Weisen-Punkte. Das andere Team kriegt nichts.
 *
 * Vokabular-Nase (Vorarlberg): „Trick" heißt hier umgangssprachlich
 * „Spiel" (das einmalige Ausspielen aller 36 Karten = ein „Spiel",
 * mehrere Spiele auf z.B. 1000 Punkte = „ein Jass"). Wir bleiben im
 * Code-Englisch bei „trick", um konsistent mit dem NN-Schwester-Repo
 * + den existierenden Test-Fixtures zu sein.
 *
 * **Punkt-Tabelle**:
 *   3-Blatt        → 20    (3 aufeinanderfolgende Karten gleicher Farbe)
 *   4-Blatt        → 50    (dito, 4 Karten)
 *   5-Blatt        → 100
 *   6-Blatt        → 120
 *   7-Blatt        → 140
 *   8-Blatt        → 160
 *   9-Blatt        → 180
 *   4×10/O/K/A     → 100   (vier gleichrangige, einer der Ränge 10-A)
 *   4×9            → 150
 *   4×U (Buur)     → 200
 *   Stöck          → 20    (separater Mechanismus, NICHT hier — siehe state.ts)
 *
 * **Vergleichs-Regel** (höchstes Weis bei mehreren):
 *   1. (a) Punkte — höher gewinnt
 *   2. (c) Höchste „ausgewiesene" Karte — natürliche Rangordnung
 *          (SECHS<…<ASS), KEIN Trump-Boost
 *   3. (b) Trumpf-Sequenz > Nicht-Trumpf-Sequenz
 *   4. (d) Vorhand-Vorteil (Anspieler des ersten Spiels gewinnt)
 *
 * **WELI** (Schelle-Sechs): IM Spiel hat sie KEINE Joker-Funktion.
 * Sie zählt als ganz normale Schelle-SECHS (Rang 0). Sie kann also in
 * der Schelle-Sequenz 6,7,8 mitspielen, aber NICHT als „springender
 * Joker" eine fehlende Karte ersetzen.
 */

import { cardsEqual } from "./cards.js";
import { type Card, type Rank, type Suit, RANK_ID, RANKS } from "./types.js";

// ──────────────────────────────────────────────────────────────────────
// Typen
// ──────────────────────────────────────────────────────────────────────

export type WeisKind =
  | "SEQUENCE_3"
  | "SEQUENCE_4"
  | "SEQUENCE_5"
  | "SEQUENCE_6"
  | "SEQUENCE_7"
  | "SEQUENCE_8"
  | "SEQUENCE_9"
  | "FOUR_OF_A_KIND";

/**
 * Eine validierte Weis-Deklaration. Wird vom Server gespeichert + an
 * andere Spieler nach Trick 1 publik gemacht.
 */
export interface WeisDeclaration {
  readonly kind: WeisKind;
  /** Karten der Deklaration, kanonisch sortiert (Sequenz: aufsteigend nach Rang; Vier-Gleiche: nach Suit). */
  readonly cards: readonly Card[];
  /** Punktwert nach Tabelle oben. */
  readonly points: number;
  /**
   * Höchste Karte der Deklaration — für die (c)-Regel im Vergleich
   * (natürliche Rangordnung, kein Trump-Boost). Bei Sequenzen: höchster
   * Rang; bei Vier-Gleichen: der eine Rang.
   */
  readonly topRank: Rank;
  /** Bei Sequenz: die Farbe. Bei Vier-Gleichen: null (vier Farben). */
  readonly suit: Suit | null;
}

/**
 * Ungültig-Markierung für `validateDeclaration`. Frontend zeigt die
 * Begründung dem User, statt einfach „abgelehnt".
 */
export type InvalidWeisReason =
  | "CARD_NOT_IN_HAND"
  | "DUPLICATE_CARDS"
  | "TOO_FEW_CARDS"
  | "TOO_MANY_CARDS"
  | "NOT_A_VALID_PATTERN";

export interface InvalidWeisDeclaration {
  readonly invalid: true;
  readonly reason: InvalidWeisReason;
}

// ──────────────────────────────────────────────────────────────────────
// Punkt-Tabelle
// ──────────────────────────────────────────────────────────────────────

const SEQUENCE_POINTS: Readonly<Record<number, number>> = {
  3: 20,
  4: 50,
  5: 100,
  6: 120,
  7: 140,
  8: 160,
  9: 180,
};

function fourOfAKindPoints(rank: Rank): number {
  if (rank === "UNTER") return 200;
  if (rank === "NEUN") return 150;
  // 10, O, K, A → 100 jeweils
  if (rank === "ZEHN" || rank === "OBER" || rank === "KOENIG" || rank === "ASS") {
    return 100;
  }
  // 6, 7, 8 dürfen kein Vierling sein (kein Weis-Punkt).
  return 0;
}

// ──────────────────────────────────────────────────────────────────────
// Validierung einer User-Deklaration
// ──────────────────────────────────────────────────────────────────────

/**
 * Prüft, ob die vom User ausgewählten Karten ein gültiges Weis ergeben
 * UND in seiner Hand vorhanden sind. Returnt entweder eine
 * `WeisDeclaration` oder `InvalidWeisDeclaration`.
 *
 * Die Methode überschneidet sich bewusst NICHT mit anderen Weisen des
 * gleichen Spielers — die Disjunktheit der Karten zwischen mehreren
 * Deklarationen prüft der Caller (Server hält die kumulative Liste).
 */
export function validateDeclaration(
  declaredCards: readonly Card[],
  hand: readonly Card[]
): WeisDeclaration | InvalidWeisDeclaration {
  // Grundbedingung: 3-9 Karten.
  if (declaredCards.length < 3) {
    return { invalid: true, reason: "TOO_FEW_CARDS" };
  }
  if (declaredCards.length > 9) {
    return { invalid: true, reason: "TOO_MANY_CARDS" };
  }

  // Keine Duplikate untereinander.
  for (let i = 0; i < declaredCards.length; i++) {
    for (let j = i + 1; j < declaredCards.length; j++) {
      if (cardsEqual(declaredCards[i]!, declaredCards[j]!)) {
        return { invalid: true, reason: "DUPLICATE_CARDS" };
      }
    }
  }

  // Alle Karten müssen in der Hand sein.
  for (const c of declaredCards) {
    if (!hand.some((h) => cardsEqual(h, c))) {
      return { invalid: true, reason: "CARD_NOT_IN_HAND" };
    }
  }

  // Pattern-Erkennung: Sequenz ODER Vier-Gleiche.
  const seq = trySequence(declaredCards);
  if (seq) return seq;
  const four = tryFourOfAKind(declaredCards);
  if (four) return four;

  return { invalid: true, reason: "NOT_A_VALID_PATTERN" };
}

function trySequence(cards: readonly Card[]): WeisDeclaration | null {
  // Alle Karten gleiche Farbe.
  const firstSuit = cards[0]!.suit;
  if (!cards.every((c) => c.suit === firstSuit)) return null;

  // Sortieren nach Rang aufsteigend, danach prüfen ob aufeinanderfolgend.
  const sorted = [...cards].sort((a, b) => RANK_ID[a.rank] - RANK_ID[b.rank]);
  for (let i = 1; i < sorted.length; i++) {
    if (RANK_ID[sorted[i]!.rank] !== RANK_ID[sorted[i - 1]!.rank] + 1) {
      return null;
    }
  }

  const len = sorted.length;
  const points = SEQUENCE_POINTS[len] ?? 0;
  if (points === 0) return null;

  const kind = `SEQUENCE_${len}` as WeisKind;

  return {
    kind,
    cards: sorted,
    points,
    topRank: sorted[sorted.length - 1]!.rank,
    suit: firstSuit,
  };
}

function tryFourOfAKind(cards: readonly Card[]): WeisDeclaration | null {
  if (cards.length !== 4) return null;
  const firstRank = cards[0]!.rank;
  if (!cards.every((c) => c.rank === firstRank)) return null;
  // Alle 4 Farben müssen einmal vorkommen.
  const suits = new Set(cards.map((c) => c.suit));
  if (suits.size !== 4) return null;

  const points = fourOfAKindPoints(firstRank);
  if (points === 0) return null; // 6,7,8 nicht erlaubt

  // Kanonisch nach Suit-ID sortieren (Eichel, Schelle, Herz, Laub).
  const sorted = [...cards].sort((a, b) => suitId(a) - suitId(b));
  return {
    kind: "FOUR_OF_A_KIND",
    cards: sorted,
    points,
    topRank: firstRank,
    suit: null,
  };
}

function suitId(c: Card): number {
  return ["EICHEL", "SCHELLE", "HERZ", "LAUB"].indexOf(c.suit);
}

// ──────────────────────────────────────────────────────────────────────
// Vergleich zweier Deklarationen — Regel a → c → b → d
// ──────────────────────────────────────────────────────────────────────

/**
 * Vergleicht zwei Weis-Deklarationen.
 *
 * Returnt:
 *   `> 0` wenn `left` höher ist
 *   `< 0` wenn `right` höher ist
 *   `0`   bei echtem Gleichstand (sollte unter Berücksichtigung aller
 *         Regeln a–d nicht vorkommen, weil d (Vorhand) immer auflöst —
 *         wenn die Sitze nicht gleich sind. Selber Sitz → 0 möglich.)
 *
 * `vorhandSeat` ist der Anspieler des ersten Spiels (Trumpf-Ansager bei
 * Spiel 1, sonst Re-Match-Sieger). Wer näher an der Vorhand sitzt
 * (= im UZS kürzester Abstand), gewinnt bei Gleichstand auf den anderen
 * drei Kriterien.
 */
export function compareDeclarations(
  left: WeisDeclaration,
  leftSeat: number,
  right: WeisDeclaration,
  rightSeat: number,
  trumpSuit: Suit | null,
  vorhandSeat: number,
  numPlayers: number = 4
): number {
  // (a) Punkte
  if (left.points !== right.points) {
    return left.points - right.points;
  }
  // (c) Höchste Karte (natürliche Rangordnung)
  const leftTop = RANK_ID[left.topRank];
  const rightTop = RANK_ID[right.topRank];
  if (leftTop !== rightTop) {
    return leftTop - rightTop;
  }
  // (b) Trumpf-Sequenz schlägt Nicht-Trumpf. Vier-Gleiche haben keine
  // Suit (null) → nicht-Trumpf.
  const leftIsTrump = left.suit === trumpSuit && trumpSuit !== null;
  const rightIsTrump = right.suit === trumpSuit && trumpSuit !== null;
  if (leftIsTrump !== rightIsTrump) {
    return leftIsTrump ? 1 : -1;
  }
  // (d) Vorhand-Vorteil — Distanz im UZS zur Vorhand.
  const leftDist = (((leftSeat - vorhandSeat) % numPlayers) + numPlayers) % numPlayers;
  const rightDist = (((rightSeat - vorhandSeat) % numPlayers) + numPlayers) % numPlayers;
  // Kleinere Distanz = näher an Vorhand = gewinnt.
  return rightDist - leftDist;
}

// ──────────────────────────────────────────────────────────────────────
// Aggregation aller Weisen pro Team → Sieger-Team + Punkte
// ──────────────────────────────────────────────────────────────────────

export interface WeisenAggregateInput {
  /** Pro Sitz die deklarierten Weisen. */
  readonly declarationsPerSeat: Readonly<Record<number, readonly WeisDeclaration[]>>;
  /** Team-Zuordnung pro Sitz (Standard Kreuz-Jass: [0,1,0,1]). */
  readonly teams: readonly number[];
  /** Trumpf-Farbe der aktuellen Runde (null bei OBEN/UNTEN). */
  readonly trumpSuit: Suit | null;
  /** Anspieler des ersten Spiels — Vorhand für die (d)-Regel. */
  readonly vorhandSeat: number;
  /** Spieler-Anzahl (4 bei Kreuz-Jass). */
  readonly numPlayers: number;
}

export interface WeisenAggregateResult {
  /**
   * Gewinner-Team-ID. `null` wenn niemand etwas gewiesen hat
   * (keine Punkte zu verteilen).
   */
  readonly winningTeam: number | null;
  /** Punkt-Summe, die das winningTeam kassiert (alle eigenen Weisen). */
  readonly points: number;
  /** Best-Weis-Karte des winningTeam — für Audit/Anzeige. */
  readonly bestDeclaration: { seat: number; declaration: WeisDeclaration } | null;
  /** Pro Team die kumulierte Punkt-Summe (nur informativ, nicht für Scoring). */
  readonly perTeam: Readonly<Record<number, number>>;
}

/**
 * Aggregiert die Weisen aller Sitze und bestimmt das Sieger-Team.
 * Nur **dieses** Team kriegt Punkte; die Weisen-Punkte der Verlierer
 * verfallen — auch wenn das andere Team summiert mehr hätte.
 */
export function aggregateWeisen(input: WeisenAggregateInput): WeisenAggregateResult {
  // 1. Pro Team Punkte sammeln + bestes Einzel-Weis ermitteln.
  const perTeam: Record<number, number> = {};
  let bestOverall: { seat: number; declaration: WeisDeclaration } | null = null;

  for (const [seatStr, declarations] of Object.entries(input.declarationsPerSeat)) {
    const seat = Number(seatStr);
    const team = input.teams[seat];
    if (team === undefined) continue;
    for (const decl of declarations) {
      perTeam[team] = (perTeam[team] ?? 0) + decl.points;
      if (
        !bestOverall ||
        compareDeclarations(
          decl,
          seat,
          bestOverall.declaration,
          bestOverall.seat,
          input.trumpSuit,
          input.vorhandSeat,
          input.numPlayers
        ) > 0
      ) {
        bestOverall = { seat, declaration: decl };
      }
    }
  }

  if (!bestOverall) {
    return {
      winningTeam: null,
      points: 0,
      bestDeclaration: null,
      perTeam,
    };
  }

  const winningTeam = input.teams[bestOverall.seat]!;
  return {
    winningTeam,
    points: perTeam[winningTeam] ?? 0,
    bestDeclaration: bestOverall,
    perTeam,
  };
}

// ──────────────────────────────────────────────────────────────────────
// KI-Hilfe: optimale Weisen-Auswahl aus einer Hand finden
// ──────────────────────────────────────────────────────────────────────

/**
 * Findet alle möglichen Weisen, die ein KI-Spieler aus seiner Hand
 * deklarieren könnte. Returnt eine Liste **disjunkter** Deklarationen
 * mit der **maximalen Gesamt-Punktzahl**. Wird vom AI-Loop genutzt,
 * damit KIs „immer korrekt ihren Weis anmelden" (User-Wunsch).
 *
 * Strategie:
 *   1. Alle Vier-Gleiche enumerieren (höchste Einzelwerte zuerst).
 *   2. Alle möglichen Sequenzen (3-9 Karten) pro Suit enumerieren.
 *   3. Greedy: höchster Einzelwert zuerst greifen, Karten markieren,
 *      mit Rest weitermachen. Eine vollständig-optimale Lösung würde
 *      Branch-and-Bound brauchen — Greedy ist hier nahezu immer
 *      optimal, weil 4×U (200) immer > als jede Sequenz mit U außer
 *      9-Blatt (180), und Karten-Overlap maximal 1 Karte pro Konflikt.
 */
export function findBestWeisenForHand(hand: readonly Card[]): WeisDeclaration[] {
  const candidates: WeisDeclaration[] = [];

  // 1. Vier-Gleiche
  for (const rank of RANKS) {
    if (fourOfAKindPoints(rank) === 0) continue;
    const cardsOfRank = hand.filter((c) => c.rank === rank);
    if (cardsOfRank.length === 4) {
      const result = tryFourOfAKind(cardsOfRank);
      if (result) candidates.push(result);
    }
  }

  // 2. Sequenzen: pro Suit alle laufenden Strecken finden, davon dann
  //    längste + alle kürzeren als separate Optionen.
  const SUITS: Suit[] = ["EICHEL", "SCHELLE", "HERZ", "LAUB"];
  for (const suit of SUITS) {
    const cardsOfSuit = hand
      .filter((c) => c.suit === suit)
      .sort((a, b) => RANK_ID[a.rank] - RANK_ID[b.rank]);
    if (cardsOfSuit.length < 3) continue;
    // Laufende Strecken zerlegen (Lücken in der Rang-Folge brechen sie ab).
    let i = 0;
    while (i < cardsOfSuit.length) {
      let j = i + 1;
      while (
        j < cardsOfSuit.length &&
        RANK_ID[cardsOfSuit[j]!.rank] === RANK_ID[cardsOfSuit[j - 1]!.rank] + 1
      ) {
        j++;
      }
      // Strecke ist cardsOfSuit[i..j-1]
      const stretch = cardsOfSuit.slice(i, j);
      if (stretch.length >= 3) {
        // Die *längste* Variante reicht — bei Greedy nehmen wir die.
        const result = trySequence(stretch);
        if (result) candidates.push(result);
      }
      i = j;
    }
  }

  // 3. Greedy nach Punkten absteigend, Karten-Konflikt-Check.
  candidates.sort((a, b) => b.points - a.points);
  const used = new Set<string>();
  const result: WeisDeclaration[] = [];
  for (const cand of candidates) {
    const keys = cand.cards.map(cardKey);
    if (keys.some((k) => used.has(k))) continue;
    for (const k of keys) used.add(k);
    result.push(cand);
  }
  return result;
}

function cardKey(c: Card): string {
  return `${c.suit}-${c.rank}`;
}
