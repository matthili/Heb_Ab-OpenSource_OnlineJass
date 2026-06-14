/**
 * Regelbasierter Heuristik-Spieler für Bodensee-Jass (2 Spieler).
 *
 * TS-Port von `players/bodensee_heuristic_player.py` (Schwester-Repo
 * jass-neuronales-netz). Nutzt dieselben Score-Tabellen wie der Kreuz/Solo-
 * `HeuristicPlayer`, aber mit Bodensee-Anpassungen:
 *   - **Ansage** über den *Pool* (Hand + sichtbarer Tisch ≈ 12 Karten), höhere
 *     Mengen-Schwelle (4 statt 3), KEIN Konzentrations-/Spread-Bonus, KEIN
 *     Schieben. Getunte Familien-Skalen (Briefing v0.9.2).
 *   - **Kartenwahl** ohne Schmieren (kein Partner) und ohne Trumpf-Disziplin
 *     (gibt es im Bodensee-Heuristik-Player bewusst nicht).
 *
 * Einsatz: leichterer KI-Gegner neben dem NN (Karten). Die **Ansage** nutzen
 * ALLE Bodensee-KI-Sitze — auch NN-Sitze, denn das NN entscheidet nur Karten.
 */
import {
  cardStrength,
  cardValue,
  RANK_ID,
  type AnnounceConstraints,
  type Announcement,
  type Card,
  type PlayMode,
  type Suit,
  type Variant,
  SUITS,
} from "@jass/engine";

import {
  GUMPF_NON_TRUMP_VALUES,
  maxBy,
  minBy,
  NON_TRUMP_HAND_VALUES,
  OBEN_HAND_VALUES,
  TRUMP_HAND_VALUES,
  UNTEN_HAND_VALUES,
} from "./heuristic-player.js";

/** Getunte Bodensee-Ansage-Parameter (NN-Briefing v0.9.2). */
export interface BodenseeAnnounceParams {
  slalomBaseFactor: number;
  gumpfScale: number;
  obenScale: number;
  untenScale: number;
}

export const BODENSEE_ANNOUNCE_PARAMS: BodenseeAnnounceParams = {
  slalomBaseFactor: 0.88,
  gumpfScale: 1.02,
  obenScale: 0.92,
  untenScale: 0.89,
};

interface ScoredAnnouncement {
  readonly announcement: Announcement;
  readonly score: number;
}

export class BodenseeHeuristicPlayer {
  private readonly params: BodenseeAnnounceParams;

  constructor(params: BodenseeAnnounceParams = BODENSEE_ANNOUNCE_PARAMS) {
    this.params = params;
  }

  // ─── Ansage ──────────────────────────────────────────────────────────

  /**
   * Beste Ansage für den Pool (Hand + sichtbare Tischkarten), gefiltert nach
   * der Tisch-Ansage-Stufe. Bodensee kennt kein Schieben → liefert immer eine
   * Ansage (TRUMPF ist auf jeder Stufe erlaubt, also nie leer).
   */
  chooseAnnouncement(pool: readonly Card[], constraints: AnnounceConstraints): Announcement {
    const { gumpfScale, obenScale, untenScale, slalomBaseFactor } = this.params;
    const candidates: ScoredAnnouncement[] = [];

    for (const suit of SUITS) {
      candidates.push({
        announcement: { variant: { mode: "TRUMPF", trump_suit: suit }, slalom: false },
        score: this.scoreTrumpf(pool, suit),
      });
      candidates.push({
        announcement: { variant: { mode: "GUMPF", trump_suit: suit }, slalom: false },
        score: Math.trunc(this.scoreGumpf(pool, suit) * gumpfScale),
      });
    }

    const obenScore = Math.trunc(this.scoreOben(pool) * obenScale);
    const untenScore = Math.trunc(this.scoreUnten(pool) * untenScale);
    candidates.push({
      announcement: { variant: { mode: "OBEN" }, slalom: false },
      score: obenScore,
    });
    candidates.push({
      announcement: { variant: { mode: "UNTEN" }, slalom: false },
      score: untenScore,
    });

    // Slalom: konservativ über max(oben, unten) × Faktor (kein Balance-Bonus).
    const slalomScore = Math.trunc(Math.max(obenScore, untenScore) * slalomBaseFactor);
    const slalomStartMode: PlayMode = obenScore >= untenScore ? "OBEN" : "UNTEN";
    candidates.push({
      announcement: { variant: { mode: slalomStartMode }, slalom: true },
      score: slalomScore,
    });

    const viable = candidates.filter((c) => {
      if (!constraints.allowedModes.has(c.announcement.variant.mode)) return false;
      if (!constraints.allowSlalom && c.announcement.slalom) return false;
      return true;
    });
    const pickFrom = viable.length > 0 ? viable : candidates;
    // Höchster Score gewinnt; Einfügereihenfolge (TRUMPF zuerst) bricht Ties stabil.
    return pickFrom.reduce((best, c) => (c.score > best.score ? c : best)).announcement;
  }

  private scoreTrumpf(pool: readonly Card[], trumpf: Suit): number {
    let score = 0;
    const trumpCount = pool.filter((c) => c.suit === trumpf).length;
    // Pool ist größer als 9 → höhere Mengen-Bonus-Schwelle (4 statt 3).
    score += Math.max(0, trumpCount - 4) * 6;
    for (const c of pool) {
      score += c.suit === trumpf ? TRUMP_HAND_VALUES[c.rank] : (NON_TRUMP_HAND_VALUES[c.rank] ?? 0);
    }
    return score;
  }

  private scoreGumpf(pool: readonly Card[], trumpf: Suit): number {
    let score = 0;
    const trumpCount = pool.filter((c) => c.suit === trumpf).length;
    score += Math.max(0, trumpCount - 4) * 6;
    for (const c of pool) {
      score += c.suit === trumpf ? TRUMP_HAND_VALUES[c.rank] : (GUMPF_NON_TRUMP_VALUES[c.rank] ?? 0);
    }
    return score;
  }

  private scoreOben(pool: readonly Card[]): number {
    let score = 0;
    for (const c of pool) score += OBEN_HAND_VALUES[c.rank] ?? 0;
    return score;
  }

  private scoreUnten(pool: readonly Card[]): number {
    let score = 0;
    for (const c of pool) score += UNTEN_HAND_VALUES[c.rank] ?? 0;
    return score;
  }

  // ─── Kartenwahl ──────────────────────────────────────────────────────

  /**
   * @param legal Bereits gefilterte legale Karten (Pool ∩ Bodensee-Maske) —
   *   die Bedien-Regeln kennt der Caller (`bodensee-game.service`).
   * @param currentTrickCards Karten im laufenden Stich (0 = ich spiele an,
   *   1 = Gegner hat vorgelegt; mehr gibt es bei 2 Spielern nicht).
   */
  chooseCard(
    legal: readonly Card[],
    currentTrickCards: readonly Card[],
    variant: Variant
  ): Card {
    if (legal.length === 0) {
      throw new Error("BodenseeHeuristicPlayer: keine legale Karte verfügbar.");
    }
    if (currentTrickCards.length === 0) {
      return this.chooseOpening(legal, variant);
    }
    // Antwort: Stich übernehmbar? (genau eine Gegnerkarte liegt)
    const leadSuit = currentTrickCards[0]!.suit;
    const oppStrength = cardStrength(currentTrickCards[0]!, leadSuit, variant);
    const winning = legal.filter((c) => cardStrength(c, leadSuit, variant) > oppStrength);
    if (winning.length > 0) {
      // Mit niedrigster reichender Karte übernehmen — der Stich ist danach zu
      // Ende, hohe Karten für später sparen.
      return minBy(winning, (c) => cardStrength(c, leadSuit, variant));
    }
    // Nicht übernehmbar: niedrigste Karte mit niedrigstem Wert abwerfen.
    return minBy(legal, (c) => [cardValue(c, variant), cardStrength(c, c.suit, variant)]);
  }

  private chooseOpening(legal: readonly Card[], variant: Variant): Card {
    if (variant.mode === "TRUMPF" || variant.mode === "GUMPF") {
      const trumpf = variant.trump_suit!;
      // Hohe Trümpfe zuerst (Buur, Nell, Ass).
      for (const rank of ["UNTER", "NEUN", "ASS"] as const) {
        const found = legal.find((c) => c.suit === trumpf && c.rank === rank);
        if (found) return found;
      }
      // Sonst: Nicht-Trumpf-Ass (sicherer Stich, solange der Gegner bedienen muss).
      const nonTrumpAce = legal.find((c) => c.suit !== trumpf && c.rank === "ASS");
      if (nonTrumpAce) return nonTrumpAce;
      // Sonst: niedrigster Wert, niedriger Rang.
      return minBy(legal, (c) => [cardValue(c, variant), RANK_ID[c.rank]]);
    }
    if (variant.mode === "OBEN") {
      for (const rank of ["ASS", "ZEHN", "KOENIG"] as const) {
        const found = legal.find((c) => c.rank === rank);
        if (found) return found;
      }
      return maxBy(legal, (c) => RANK_ID[c.rank]);
    }
    // UNTEN
    for (const rank of ["SECHS", "SIEBEN", "ACHT"] as const) {
      const found = legal.find((c) => c.rank === rank);
      if (found) return found;
    }
    return minBy(legal, (c) => RANK_ID[c.rank]);
  }
}
