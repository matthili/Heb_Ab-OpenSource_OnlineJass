/**
 * „Bergpreis"-Sieger für Bodensee (2 Spieler). Nutzt dieselbe Kern-Logik wie
 * Kreuz/Solo (`bergpreisWinner`), nur ohne Weis/Stöck — Bodensee kennt die
 * nicht. Jeder Spieler ist sein eigenes „Team" (Index 0/1). Matsch = alle 18
 * Stiche (+100), „Sack" gatet wie gehabt (< 21 Kartenpunkte zählt nichts).
 */
import { bergpreisWinner } from "../bergpreis.js";
import { trickPoints } from "../rules.js";
import { bodenseeEffectiveVariant } from "./state.js";
import { BODENSEE_TRICKS_PER_ROUND, type BodenseeRoundState } from "./types.js";

/** Team-/Spieler-Index (0|1) des Erst-Erreichers, oder -1. */
export function bodenseeBergpreisWinnerFromState(
  state: BodenseeRoundState,
  preGameCumulative: readonly number[],
  target: number
): number {
  const trickPointsPerTrick: number[] = [];
  const trickWinnerTeams: number[] = [];
  for (let i = 0; i < state.trick_winners.length; i++) {
    const seat = state.trick_winners[i];
    const trick = state.completed_tricks[i];
    if (seat === undefined || trick === undefined) continue;
    const isLast = i === BODENSEE_TRICKS_PER_ROUND - 1;
    trickPointsPerTrick.push(
      trickPoints(trick.cards, bodenseeEffectiveVariant(state.announcement, i), isLast)
    );
    trickWinnerTeams.push(seat); // Spieler 0|1 ist hier zugleich das „Team".
  }

  let matschTeam = -1;
  for (let p = 0; p < 2; p++) {
    if (state.trick_winners.filter((w) => w === p).length === BODENSEE_TRICKS_PER_ROUND) {
      matschTeam = p;
      break;
    }
  }

  return bergpreisWinner({
    numTeams: 2,
    preGameCumulative,
    target,
    trickPointsPerTrick,
    trickWinnerTeams,
    weisPerTeam: [0, 0],
    stoeckTeam: null,
    matschTeam,
    sackRule: state.sack_rule === true,
    weisNeedsTrick: false,
  });
}
