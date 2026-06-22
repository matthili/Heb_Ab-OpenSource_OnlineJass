/**
 * „Bergpreis": Sieger einer **Partie** (über mehrere Spiele auf ein Punkteziel)
 * ist, wer beim Hochzählen der Schluss-Partie das Ziel ZUERST berührt — auch
 * wenn der andere am Ende mehr Gesamtpunkte hätte. Relevant nur, wenn mehrere
 * im selben Schluss-Spiel übers Ziel gehen; sonst gewinnt ohnehin der einzige
 * Zielerreicher.
 *
 * Zähl-Modell (am Rundenende deckungsgleich mit `finalRoundScore`):
 *   - Kartenpunkte **Stich für Stich** in Spielreihenfolge (letzter Stich +5).
 *   - Weis/Stöck als **Vorsprung von Beginn an** …
 *   - … ABER bei `sackRule` zählt für ein Team NICHTS, solange es weniger als
 *     `SACK_MIN_POINTS` reine Stich-Kartenpunkte hat (vorher provisorisch — es
 *     würde am Rundenende ja komplett verfallen).
 *   - `weisNeedsTrick`: Weis zählt erst ab dem ersten eigenen Stich.
 *   - Matsch (+100) zählt am letzten Stich; wer erst dadurch übers Ziel kommt,
 *     gewinnt ebenfalls.
 *
 * Die reine Kern-Funktion `bergpreisWinner` arbeitet auf Primitiv-Arrays und ist
 * damit ohne echtes Kartenmaterial testbar; `bergpreisWinnerFromState` leitet die
 * Eingaben aus einem fertigen Kreuz/Solo-`RoundState` ab.
 */
import { trickPoints } from "./rules.js";
import { effectiveVariant, type RoundState } from "./state.js";
import { MATCH_BONUS, SACK_MIN_POINTS, STOECK_BONUS, TRICKS_PER_ROUND } from "./types.js";

export interface BergpreisInput {
  numTeams: number;
  /** Kumulative Partie-Stände VOR diesem Spiel, je Team. */
  preGameCumulative: readonly number[];
  target: number;
  /** Kartenpunkte je Stich in Spielreihenfolge (letzter Stich inkl. +5). */
  trickPointsPerTrick: readonly number[];
  /** Team, das den jeweiligen Stich gewonnen hat (gleiche Reihenfolge). */
  trickWinnerTeams: readonly number[];
  weisPerTeam: readonly number[];
  stoeckTeam: number | null;
  /** Team mit allen Stichen (Matsch); -1 = keiner. */
  matschTeam: number;
  sackRule: boolean;
  weisNeedsTrick: boolean;
}

/**
 * Team-Index des Erst-Erreichers, oder -1, wenn niemand das Ziel erreicht
 * (bei einer beendeten Partie nicht zu erwarten — der Aufrufer fällt dann auf
 * den höchsten Stand zurück).
 */
export function bergpreisWinner(input: BergpreisInput): number {
  const {
    numTeams,
    preGameCumulative,
    target,
    trickPointsPerTrick,
    trickWinnerTeams,
    weisPerTeam,
    stoeckTeam,
    matschTeam,
    sackRule,
    weisNeedsTrick,
  } = input;

  const cardFromTricks = new Array<number>(numTeams).fill(0);
  const trickCount = new Array<number>(numTeams).fill(0);
  const numTricks = trickPointsPerTrick.length;

  const countedTotal = (t: number, atLastTrick: boolean): number => {
    const cards = cardFromTricks[t] ?? 0;
    // „Sack": bis 21 reine Kartenpunkte zählt für dieses Team gar nichts.
    if (sackRule && cards < SACK_MIN_POINTS) return 0;
    let total = cards;
    if (!weisNeedsTrick || (trickCount[t] ?? 0) >= 1) total += weisPerTeam[t] ?? 0;
    if (stoeckTeam === t) total += STOECK_BONUS;
    if (atLastTrick && t === matschTeam) total += MATCH_BONUS;
    return total;
  };

  // Erstes Team, dessen Match-Stand das Ziel berührt. Pro Schritt erhöht sich
  // nur EIN Konto (der Stich-Gewinner), daher kann nur eines neu überschreiten;
  // bei Gleichstand (z.B. Vorsprung-Check) nehmen wir den höheren Stand.
  const crossing = (atLastTrick: boolean): number => {
    let best = -1;
    let bestTotal = -1;
    for (let t = 0; t < numTeams; t++) {
      const total = (preGameCumulative[t] ?? 0) + countedTotal(t, atLastTrick);
      if (total >= target && total > bestTotal) {
        best = t;
        bestTotal = total;
      }
    }
    return best;
  };

  // Vorsprung-Check vor dem ersten Stich (Weis/Stöck, sofern kein Sack greift).
  let w = crossing(false);
  if (w >= 0) return w;

  for (let i = 0; i < numTricks; i++) {
    const team = trickWinnerTeams[i];
    if (team === undefined || team < 0 || team >= numTeams) continue;
    cardFromTricks[team] = (cardFromTricks[team] ?? 0) + (trickPointsPerTrick[i] ?? 0);
    trickCount[team] = (trickCount[team] ?? 0) + 1;
    w = crossing(i === numTricks - 1);
    if (w >= 0) return w;
  }
  return -1;
}

/** Leitet die Bergpreis-Eingaben aus einem fertigen Kreuz/Solo-`RoundState` ab. */
export function bergpreisWinnerFromState(
  state: RoundState,
  preGameCumulative: readonly number[],
  target: number
): number {
  const numTeams = state.team_card_points.length;
  const teams = state.teams;
  const trickPointsPerTrick: number[] = [];
  const trickWinnerTeams: number[] = [];
  const trickCount = new Array<number>(numTeams).fill(0);

  for (let i = 0; i < state.trick_winners.length; i++) {
    const seat = state.trick_winners[i];
    const trick = state.completed_tricks[i];
    const team = seat !== undefined ? teams[seat] : undefined;
    if (team === undefined || trick === undefined) continue;
    const isLast = i === TRICKS_PER_ROUND - 1;
    trickPointsPerTrick.push(
      trickPoints(trick.cards, effectiveVariant(state.announcement, i), isLast)
    );
    trickWinnerTeams.push(team);
    trickCount[team] = (trickCount[team] ?? 0) + 1;
  }

  let matschTeam = -1;
  for (let t = 0; t < numTeams; t++) {
    if (trickCount[t] === TRICKS_PER_ROUND) {
      matschTeam = t;
      break;
    }
  }

  return bergpreisWinner({
    numTeams,
    preGameCumulative,
    target,
    trickPointsPerTrick,
    trickWinnerTeams,
    weisPerTeam: state.weisen_team_points ?? new Array<number>(numTeams).fill(0),
    stoeckTeam: state.stoeck_announced_team,
    matschTeam,
    sackRule: state.sack_rule === true,
    weisNeedsTrick: state.weis_needs_trick === true,
  });
}
