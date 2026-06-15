/**
 * Regelbasierter Heuristik-Spieler — TS-Port von `players/heuristic_player.py`
 * aus dem NN-Schwester-Repo JCN9000.
 *
 * **Spielstärke**: deutlich über `RandomLegalMovePlayer`. Im NN-Repo wurde
 * dieser Spieler als Behavioral-Cloning-Lehrer eingesetzt. Für uns ist er:
 *   - Default-KI im Live-Spiel (deutlich angenehmer als Random für Menschen)
 *   - Quelle der KI-Ansage-Entscheidung (siehe `chooseAnnouncement`)
 *
 * Strategien (1:1 aus dem Python-Original):
 *
 *   **Kartenwahl** — `chooseCard`:
 *     - Anspielen: bei TRUMPF hohe Trümpfe ziehen (Buur/Nell/Ass), bei OBEN
 *       Asse, bei UNTEN niedrige Karten.
 *     - Stich übernehmen wenn möglich: als letzter Spieler so knapp wie
 *       nötig, sonst so hoch wie sinnvoll.
 *     - Schmieren: wenn der Partner führt, hohe Punktkarte legen, ohne ihn
 *       zu übertrumpfen.
 *     - Sparen: wenn nicht gewinnbar und Partner nicht führt, niedrigste
 *       Karte mit niedrigstem Wert abwerfen.
 *
 *   **Ansage** — `chooseAnnouncement` (Sprint C):
 *     - Score je Variante (TRUMPF×4 Farben, GUMPF×4, OBEN, UNTEN, SLALOM).
 *     - Höchster Score gewinnt. Liegt der unter `pushThreshold` und Schieben
 *       ist erlaubt → null (= Schieben).
 *
 * **Determinismus**: ein optionales `seed`-Argument kann beim Konstruktor
 * mitgegeben werden. Aktuell nicht benötigt, weil die Strategie deterministisch
 * ist außer bei Ties — die brechen wir per stabiler Sortierung. So sind
 * Heuristic-vs-Heuristic-Self-Plays reproduzierbar.
 */
import {
  cardStrength,
  cardValue,
  inferForbiddenCards,
  legalMoves,
  seatIsVoidInTrump,
  type Announcement,
  type Card,
  type GameState,
  type PlayMode,
  type Rank,
  type Suit,
  type Variant,
  SUITS,
} from "@jass/engine";

import type { AIPlayer } from "./random-player.js";

// ─── Score-Tabellen (1:1 aus heuristic_player.py) ───────────────────────

export const TRUMP_HAND_VALUES: Readonly<Record<Rank, number>> = {
  UNTER: 25, // Buur
  NEUN: 18, // Nell
  ASS: 12,
  ZEHN: 7,
  KOENIG: 6,
  OBER: 5,
  ACHT: 3,
  SIEBEN: 2,
  SECHS: 1,
};

export const NON_TRUMP_HAND_VALUES: Partial<Record<Rank, number>> = {
  ASS: 9,
  ZEHN: 5,
  KOENIG: 3,
  OBER: 1,
};

export const OBEN_HAND_VALUES: Partial<Record<Rank, number>> = {
  ASS: 13,
  KOENIG: 8,
  ZEHN: 7,
  OBER: 5,
  ACHT: 4, // 8 Punkte
  UNTER: 2,
  NEUN: 1,
};

export const UNTEN_HAND_VALUES: Partial<Record<Rank, number>> = {
  SECHS: 13,
  SIEBEN: 9,
  ACHT: 8, // stark UND 8 Punkte
  NEUN: 5,
  ZEHN: 2,
};

export const GUMPF_NON_TRUMP_VALUES: Partial<Record<Rank, number>> = {
  SECHS: 6,
  SIEBEN: 4,
  ACHT: 4,
  NEUN: 2,
  ZEHN: 1,
};

const OBEN_RANKS: readonly Rank[] = ["ASS", "KOENIG", "OBER"];
const UNTEN_RANKS: readonly Rank[] = ["SECHS", "SIEBEN", "ACHT"];

export interface HeuristicOptions {
  /** Untergrenze des besten Scores — sonst wird (wenn erlaubt) geschoben. */
  pushThreshold?: number;
  /** Slalom-Score = max(oben, unten) × baseFactor + balanceBonus. */
  slalomBaseFactor?: number;
  slalomConcentrationFactor?: number;
  slalomSpreadFactor?: number;
  /**
   * Familien-Multiplikatoren auf den Ansage-Score VOR dem argmax (Trumpf =
   * Anker, immer 1.0). Per Win-Rate-Suche im NN-Repo getunt (Briefings
   * v0.7.2/v0.8.2). Default 1 = neutral (kein Effekt). Wirkt nur auf die
   * jeweiligen Kandidaten; Slalom rechnet bewusst mit den Roh-Scores.
   */
  gumpfScale?: number;
  obenScale?: number;
  untenScale?: number;
  /** Hausregel: erlaubte Modi für die Ansage. `undefined` = alle. */
  allowedModes?: ReadonlySet<PlayMode>;
  /** Wenn `false`, wird Slalom nicht in Betracht gezogen. */
  allowSlalom?: boolean;
  /**
   * Trumpf-Disziplin beim Anspielen: Sind beim Lead in TRUMPF/GUMPF beide
   * Gegner beweisbar trumpffrei (Buur ignoriert), keine hohen Trümpfe mehr
   * ziehen — man zöge sonst nur dem Partner die Trümpfe. Default `true`.
   * (NN-Briefing v0.7.2/v0.8.2, Punkt 2b.)
   */
  trumpVoidAwareness?: boolean;
}

/**
 * Getunte Ansage-Parameter je Spielart (NN-Repo-Briefings v0.7.2 / v0.8.2,
 * per Win-Rate-Suche optimiert). Werden in `game.service` an den
 * `HeuristicPlayer` für die KI-Ansage übergeben.
 *
 * **Bodensee** hat hier bewusst keinen Eintrag: Die Bodensee-KI-Ansage ist
 * ein eigener, simpler Trumpf-Picker (`bodensee-game.service`), kein Port
 * dieser Heuristik — die Bodensee-Tuning-Werte aus dem Briefing v0.9.2 hätten
 * dort keinen Angriffspunkt.
 */
export const KREUZ_ANNOUNCE_PARAMS: HeuristicOptions = {
  pushThreshold: 64,
  slalomBaseFactor: 0.9,
  slalomConcentrationFactor: 2,
  slalomSpreadFactor: 1,
  gumpfScale: 1.15,
  obenScale: 0.96,
  untenScale: 1.08,
};

export const SOLO_ANNOUNCE_PARAMS: HeuristicOptions = {
  // Im Solo-Jass gibt es kein Schieben → pushThreshold ist irrelevant.
  slalomBaseFactor: 0.94,
  slalomConcentrationFactor: 1,
  slalomSpreadFactor: 1,
  gumpfScale: 1.06,
  obenScale: 0.91,
  untenScale: 1.1,
};

interface AnnouncementWithScore {
  readonly announcement: Announcement;
  readonly score: number;
}

export class HeuristicPlayer implements AIPlayer {
  private readonly pushThreshold: number;
  private readonly slalomBaseFactor: number;
  private readonly slalomConcentrationFactor: number;
  private readonly slalomSpreadFactor: number;
  private readonly gumpfScale: number;
  private readonly obenScale: number;
  private readonly untenScale: number;
  private readonly allowedModes: ReadonlySet<PlayMode> | undefined;
  private readonly allowSlalom: boolean;
  private readonly trumpVoidAwareness: boolean;

  constructor(opts: HeuristicOptions = {}) {
    this.pushThreshold = opts.pushThreshold ?? 55;
    this.slalomBaseFactor = opts.slalomBaseFactor ?? 0.95;
    this.slalomConcentrationFactor = opts.slalomConcentrationFactor ?? 2;
    this.slalomSpreadFactor = opts.slalomSpreadFactor ?? 1;
    this.gumpfScale = opts.gumpfScale ?? 1;
    this.obenScale = opts.obenScale ?? 1;
    this.untenScale = opts.untenScale ?? 1;
    this.allowedModes = opts.allowedModes;
    this.allowSlalom = opts.allowSlalom ?? true;
    this.trumpVoidAwareness = opts.trumpVoidAwareness ?? true;
  }

  // ─── Ansage ────────────────────────────────────────────────────────

  /**
   * Liefert die beste Ansage für diese Hand. Wenn Schieben erlaubt ist
   * (`canPush=true`) und alle Scores unter `pushThreshold` liegen, wird
   * `null` zurückgegeben — das signalisiert dem Caller „schiebe an den
   * Partner".
   */
  chooseAnnouncement(hand: readonly Card[], canPush: boolean): Announcement | null {
    const candidates: AnnouncementWithScore[] = [];

    // TRUMPF × 4 Farben
    for (const suit of SUITS) {
      candidates.push({
        announcement: { variant: { mode: "TRUMPF", trump_suit: suit }, slalom: false },
        score: this.scoreTrumpf(hand, suit),
      });
    }

    // GUMPF × 4 Farben (gleiche Trumpf-Logik, aber Non-Trumpf wie Geiss).
    // gumpfScale: getunter Familien-Multiplikator (Default 1 = neutral).
    for (const suit of SUITS) {
      candidates.push({
        announcement: { variant: { mode: "GUMPF", trump_suit: suit }, slalom: false },
        score: this.scoreGumpf(hand, suit) * this.gumpfScale,
      });
    }

    // Roh-Scores: Slalom (unten) rechnet bewusst mit diesen, die Familien-
    // Skalierung (oben/unten) wirkt nur auf die jeweiligen Kandidaten.
    const obenScore = this.scoreOben(hand);
    const untenScore = this.scoreUnten(hand);
    candidates.push({
      announcement: { variant: { mode: "OBEN" }, slalom: false },
      score: obenScore * this.obenScale,
    });
    candidates.push({
      announcement: { variant: { mode: "UNTEN" }, slalom: false },
      score: untenScore * this.untenScale,
    });

    // Slalom: Basis = stärkere Single-Variante × baseFactor; plus Bonus
    // für Hand-Balance (Karten an beiden Enden des Spektrums).
    const slalomScore = this.scoreSlalom(hand, obenScore, untenScore);
    const slalomStartMode: PlayMode = obenScore >= untenScore ? "OBEN" : "UNTEN";
    candidates.push({
      announcement: { variant: { mode: slalomStartMode }, slalom: true },
      score: slalomScore,
    });

    // Hausregel-Filter
    const filtered = candidates.filter((c) => {
      if (this.allowedModes && !this.allowedModes.has(c.announcement.variant.mode)) {
        return false;
      }
      if (!this.allowSlalom && c.announcement.slalom) return false;
      return true;
    });

    if (filtered.length === 0) {
      if (canPush) return null;
      throw new Error(
        "HeuristicPlayer: alle Ansage-Optionen sind durch Hausregeln gefiltert und Schieben ist nicht erlaubt."
      );
    }

    // Höchster Score gewinnt. Bei Ties greift die Einfügereihenfolge oben
    // (TRUMPF vor GUMPF vor OBEN/UNTEN/SLALOM) — stabil.
    filtered.sort((a, b) => b.score - a.score);
    const best = filtered[0]!;

    if (canPush && best.score < this.pushThreshold) {
      return null;
    }
    return best.announcement;
  }

  private scoreTrumpf(hand: readonly Card[], trumpf: Suit): number {
    let score = 0;
    const trumpCount = hand.filter((c) => c.suit === trumpf).length;
    score += Math.max(0, trumpCount - 3) * 6;
    for (const c of hand) {
      if (c.suit === trumpf) {
        score += TRUMP_HAND_VALUES[c.rank];
      } else {
        score += NON_TRUMP_HAND_VALUES[c.rank] ?? 0;
      }
    }
    return score;
  }

  private scoreGumpf(hand: readonly Card[], trumpf: Suit): number {
    let score = 0;
    const trumpCount = hand.filter((c) => c.suit === trumpf).length;
    score += Math.max(0, trumpCount - 3) * 6;
    for (const c of hand) {
      if (c.suit === trumpf) {
        score += TRUMP_HAND_VALUES[c.rank];
      } else {
        score += GUMPF_NON_TRUMP_VALUES[c.rank] ?? 0;
      }
    }
    return score;
  }

  private scoreOben(hand: readonly Card[]): number {
    let score = 0;
    for (const c of hand) score += OBEN_HAND_VALUES[c.rank] ?? 0;
    return score;
  }

  private scoreUnten(hand: readonly Card[]): number {
    let score = 0;
    for (const c of hand) score += UNTEN_HAND_VALUES[c.rank] ?? 0;
    return score;
  }

  private scoreSlalom(hand: readonly Card[], obenScore: number, untenScore: number): number {
    const perSuitOben: Record<Suit, number> = { EICHEL: 0, SCHELLE: 0, HERZ: 0, LAUB: 0 };
    const perSuitUnten: Record<Suit, number> = { EICHEL: 0, SCHELLE: 0, HERZ: 0, LAUB: 0 };
    for (const c of hand) {
      if (OBEN_RANKS.includes(c.rank)) perSuitOben[c.suit] += 1;
      else if (UNTEN_RANKS.includes(c.rank)) perSuitUnten[c.suit] += 1;
    }
    const maxObenPerSuit = Math.max(...Object.values(perSuitOben));
    const maxUntenPerSuit = Math.max(...Object.values(perSuitUnten));
    const nObenTotal = Object.values(perSuitOben).reduce((a, b) => a + b, 0);
    const nUntenTotal = Object.values(perSuitUnten).reduce((a, b) => a + b, 0);
    const konzentrationsBonus =
      Math.min(maxObenPerSuit, maxUntenPerSuit) * this.slalomConcentrationFactor;
    const spreadBonus = Math.min(nObenTotal, nUntenTotal) * this.slalomSpreadFactor;
    return (
      Math.floor(Math.max(obenScore, untenScore) * this.slalomBaseFactor) +
      konzentrationsBonus +
      spreadBonus
    );
  }

  // ─── Kartenwahl ────────────────────────────────────────────────────

  chooseCard(hand: readonly Card[], state: GameState): Card {
    const legal = legalMoves(hand, state.current_trick_cards, state.variant);
    if (legal.length === 0) {
      throw new Error("HeuristicPlayer: keine legalen Züge verfügbar");
    }

    // Erste Karte im Stich
    if (state.current_trick_cards.length === 0) {
      return this.chooseOpening(legal, state);
    }

    const leadSuit = state.current_trick_cards[0]!.suit;
    const winningCards = this.winningCards(legal, leadSuit, state);
    const partnerWinning = this.isPartnerWinning(state);
    const afterMe = playersAfterMeInTrick(state);

    // Partner führt → schmieren
    if (partnerWinning) {
      return this.schmieren(legal, winningCards, state, leadSuit);
    }

    // Stich übernehmbar?
    if (winningCards.length > 0) {
      if (afterMe === 0) {
        // Letzter im Stich: knapp übernehmen
        return minBy(winningCards, (c) => cardStrength(c, leadSuit, state.variant));
      }
      // Sonst: mit hoher Karte sichern
      return maxBy(winningCards, (c) => cardStrength(c, leadSuit, state.variant));
    }

    // Nicht gewinnbar → sparen
    return this.sparen(legal, state);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private winningCards(legal: readonly Card[], leadSuit: Suit, state: GameState): Card[] {
    const currentBest = Math.max(
      ...state.current_trick_cards.map((c) => cardStrength(c, leadSuit, state.variant))
    );
    return legal.filter((c) => cardStrength(c, leadSuit, state.variant) > currentBest);
  }

  private isPartnerWinning(state: GameState): boolean {
    if (state.current_trick_cards.length === 0) return false;
    const leadSuit = state.current_trick_cards[0]!.suit;
    const strengths = state.current_trick_cards.map((c) =>
      cardStrength(c, leadSuit, state.variant)
    );
    let bestIdx = 0;
    for (let i = 1; i < strengths.length; i++) {
      if (strengths[i]! > strengths[bestIdx]!) bestIdx = i;
    }
    const winningSeat = (state.current_trick_starter + bestIdx) % state.num_players;
    if (winningSeat === state.player_idx) return false;
    return state.teams[winningSeat] === state.teams[state.player_idx];
  }

  private schmieren(
    legal: readonly Card[],
    winningCards: readonly Card[],
    state: GameState,
    leadSuit: Suit
  ): Card {
    const winningSet = new Set(winningCards.map((c) => `${c.suit}-${c.rank}`));
    const nonOvertrumping = legal.filter((c) => !winningSet.has(`${c.suit}-${c.rank}`));
    if (nonOvertrumping.length > 0) {
      return maxBy(nonOvertrumping, (c) => cardValue(c, state.variant));
    }
    // Zwangslage: alle legalen Karten würden den Partner übertrumpfen.
    // Niedrigste übertrumpfende Karte: erst nach value, dann nach strength.
    return minBy(legal, (c) => [
      cardValue(c, state.variant),
      cardStrength(c, leadSuit, state.variant),
    ]);
  }

  private sparen(legal: readonly Card[], state: GameState): Card {
    return minBy(legal, (c) => [
      cardValue(c, state.variant),
      cardStrength(c, c.suit, state.variant),
    ]);
  }

  /**
   * True, wenn ALLE Gegner beweisbar trumpffrei sind (Buur ignoriert) — dann
   * bringt Trumpf-Ziehen nichts, man zöge nur dem Partner die Trümpfe. Leitet
   * die Voids aus der Stichhistorie (`completed_tricks`) ab.
   */
  private opponentsVoidInTrump(state: GameState, trumpf: Suit): boolean {
    if (!this.trumpVoidAwareness) return false;
    const forbidden = inferForbiddenCards(state.completed_tricks, trumpf, state.num_players);
    const myTeam = state.teams[state.player_idx];
    const opponents: number[] = [];
    for (let s = 0; s < state.num_players; s++) {
      if (state.teams[s] !== myTeam) opponents.push(s);
    }
    if (opponents.length === 0) return false;
    return opponents.every((s) =>
      seatIsVoidInTrump(forbidden.get(s) ?? new Set<string>(), trumpf)
    );
  }

  private chooseOpening(legal: readonly Card[], state: GameState): Card {
    const variant: Variant = state.variant;
    if (variant.mode === "TRUMPF") {
      const trumpf = variant.trump_suit!;
      // Hohe Trümpfe ziehen — aber nur, solange die Gegner überhaupt noch
      // Trumpf haben können. Sind beide blank, spielt man hohe Seitenkarten an
      // und behält die Trümpfe als sichere Sticher (sonst zieht man im Team nur
      // sich selbst die Trümpfe aus der Hand).
      if (!this.opponentsVoidInTrump(state, trumpf)) {
        for (const rank of ["UNTER", "NEUN", "ASS"] as const) {
          const found = legal.find((c) => c.suit === trumpf && c.rank === rank);
          if (found) return found;
        }
      }
      // Asse nicht-trumpf
      const nonTrumpAce = legal.find((c) => c.suit !== trumpf && c.rank === "ASS");
      if (nonTrumpAce) return nonTrumpAce;
      const nonTrumps = legal.filter((c) => c.suit !== trumpf);
      if (nonTrumps.length > 0) {
        return minBy(nonTrumps, (c) => [cardValue(c, variant), rankOrdinal(c.rank)]);
      }
      return minBy(legal, (c) => cardValue(c, variant));
    }

    if (variant.mode === "GUMPF") {
      const trumpf = variant.trump_suit!;
      // Trumpf-Disziplin wie bei TRUMPF: keine hohen Trümpfe ziehen, wenn die
      // Gegner schon trumpffrei sind.
      if (!this.opponentsVoidInTrump(state, trumpf)) {
        for (const rank of ["UNTER", "NEUN", "ASS"] as const) {
          const found = legal.find((c) => c.suit === trumpf && c.rank === rank);
          if (found) return found;
        }
      }
      // In Nicht-Trumpf-Farben: 6er sind die sicheren Sticher (Geiss-Logik).
      const nonTrumpSix = legal.find((c) => c.suit !== trumpf && c.rank === "SECHS");
      if (nonTrumpSix) return nonTrumpSix;
      const nonTrumps = legal.filter((c) => c.suit !== trumpf);
      if (nonTrumps.length > 0) {
        return minBy(nonTrumps, (c) => [cardValue(c, variant), rankOrdinal(c.rank)]);
      }
      return minBy(legal, (c) => cardValue(c, variant));
    }

    if (variant.mode === "OBEN") {
      for (const rank of ["ASS", "ZEHN", "KOENIG"] as const) {
        const found = legal.find((c) => c.rank === rank);
        if (found) return found;
      }
      return maxBy(legal, (c) => rankOrdinal(c.rank));
    }

    // UNTEN
    for (const rank of ["SECHS", "SIEBEN", "ACHT"] as const) {
      const found = legal.find((c) => c.rank === rank);
      if (found) return found;
    }
    return minBy(legal, (c) => rankOrdinal(c.rank));
  }
}

// ─── Kleine generische Helpers (lokal, damit der Player allein steht) ────

function rankOrdinal(rank: Rank): number {
  const ORDER: readonly Rank[] = [
    "SECHS",
    "SIEBEN",
    "ACHT",
    "NEUN",
    "ZEHN",
    "UNTER",
    "OBER",
    "KOENIG",
    "ASS",
  ];
  return ORDER.indexOf(rank);
}

/** Wie viele Spieler kommen NACH mir noch in diesem Stich? */
function playersAfterMeInTrick(state: GameState): number {
  const played = state.current_trick_cards.length;
  return state.num_players - 1 - played;
}

/** Sortier-Key-Tuple-Vergleich: erstes Feld zuerst, dann zweites usw. */
function compareTuple(a: number | number[], b: number | number[]): number {
  const aa = Array.isArray(a) ? a : [a];
  const bb = Array.isArray(b) ? b : [b];
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i]! < bb[i]!) return -1;
    if (aa[i]! > bb[i]!) return 1;
  }
  return aa.length - bb.length;
}

export function minBy<T>(items: readonly T[], key: (x: T) => number | number[]): T {
  let best = items[0]!;
  let bestKey = key(best);
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]!);
    if (compareTuple(k, bestKey) < 0) {
      best = items[i]!;
      bestKey = k;
    }
  }
  return best;
}

export function maxBy<T>(items: readonly T[], key: (x: T) => number | number[]): T {
  let best = items[0]!;
  let bestKey = key(best);
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]!);
    if (compareTuple(k, bestKey) > 0) {
      best = items[i]!;
      bestKey = k;
    }
  }
  return best;
}
