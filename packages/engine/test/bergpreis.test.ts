/**
 * Tests für den „Bergpreis"-Sieger: wer beim Hochzählen der Schluss-Partie das
 * Ziel ZUERST berührt, gewinnt — auch mit am Ende weniger Gesamtpunkten.
 *
 * Die reine `bergpreisWinner`-Funktion wird mit erfundenen Zahlen geprüft (kein
 * Kartenmaterial nötig); `bergpreisWinnerFromState` mit synthetischen, fertigen
 * RoundStates (leere Tricks → deterministische Stich-Punkte: nur der letzte
 * Stich bringt +5).
 */
import { describe, expect, it } from "vitest";

import { bergpreisWinner, bergpreisWinnerFromState } from "../src/bergpreis.js";
import { dealCards, newRound, type RoundState } from "../src/state.js";
import type { Card } from "../src/types.js";

function seededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

describe("bergpreisWinner (reine Logik)", () => {
  it("normaler Fall: Erst-Erreicher gewinnt", () => {
    // t0 holt im ersten Stich 60 Punkte → 450+60=510 ≥ 500.
    const winner = bergpreisWinner({
      numTeams: 2,
      preGameCumulative: [450, 480],
      target: 500,
      trickPointsPerTrick: [60, 20, 20],
      trickWinnerTeams: [0, 1, 1],
      weisPerTeam: [0, 0],
      stoeckTeam: null,
      matschTeam: -1,
      sackRule: false,
      weisNeedsTrick: false,
    });
    expect(winner).toBe(0);
  });

  it("beide gehen im Schlussspiel übers Ziel → wer ZUERST erreicht, gewinnt (nicht der mit mehr)", () => {
    // t1 liegt vorne (495) und braucht nur 5; t0 (490) braucht 10.
    // Stich 0: 6 an t1 → 501 ≥ 500 (t1 erreicht zuerst). Danach räumt t0 ab
    // (insgesamt mehr Punkte), gewinnt die Partie aber NICHT.
    const winner = bergpreisWinner({
      numTeams: 2,
      preGameCumulative: [490, 495],
      target: 500,
      trickPointsPerTrick: [6, 100, 0],
      trickWinnerTeams: [1, 0, 0],
      weisPerTeam: [0, 0],
      stoeckTeam: null,
      matschTeam: -1,
      sackRule: false,
      weisNeedsTrick: false,
    });
    expect(winner).toBe(1);
  });

  it("ohne Sack: Weis zählt als Vorsprung sofort (Crossing vor dem ersten Stich)", () => {
    const winner = bergpreisWinner({
      numTeams: 2,
      preGameCumulative: [900, 900],
      target: 1000,
      trickPointsPerTrick: [30, 30, 25, 20],
      trickWinnerTeams: [1, 1, 1, 1],
      weisPerTeam: [100, 0], // t0: 900+100 = 1000 → erreicht zu Beginn
      stoeckTeam: null,
      matschTeam: -1,
      sackRule: false,
      weisNeedsTrick: false,
    });
    expect(winner).toBe(0);
  });

  it("mit Sack: derselbe Weis ist gesperrt, bis 21 Stich-Kartenpunkte stehen → der andere erreicht zuerst", () => {
    // Gleiche Eingaben wie oben, nur sackRule=true: t0s Weis (100) zählt erst
    // ab 21 Kartenpunkten — die holt t0 nie (gewinnt keinen Stich). t1 zieht
    // über die Kartenpunkte vorbei: 900 + (30+30+25+20=105) = 1005 ≥ 1000.
    const winner = bergpreisWinner({
      numTeams: 2,
      preGameCumulative: [900, 900],
      target: 1000,
      trickPointsPerTrick: [30, 30, 25, 20],
      trickWinnerTeams: [1, 1, 1, 1],
      weisPerTeam: [100, 0],
      stoeckTeam: null,
      matschTeam: -1,
      sackRule: true,
      weisNeedsTrick: false,
    });
    expect(winner).toBe(1);
  });

  it("Matsch-Bonus kann der entscheidende Schritt übers Ziel sein", () => {
    // t0 macht Matsch (alle Stiche, hier 9 zu je 17/18 = 157 Kartenpunkte).
    // Ziel 1058: 900+157 = 1057 < 1058 → über Karten allein NICHT erreicht;
    // erst mit +100 Matsch am letzten Stich (1157) ist das Ziel berührt.
    const trickPointsPerTrick = [17, 17, 17, 17, 17, 17, 17, 18, 20]; // Summe 157
    const trickWinnerTeams = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const withMatsch = bergpreisWinner({
      numTeams: 2,
      preGameCumulative: [900, 0],
      target: 1058,
      trickPointsPerTrick,
      trickWinnerTeams,
      weisPerTeam: [0, 0],
      stoeckTeam: null,
      matschTeam: 0,
      sackRule: false,
      weisNeedsTrick: false,
    });
    expect(withMatsch).toBe(0);

    // Gegenprobe: ohne Matsch-Bonus wird das (knappe) Ziel nicht erreicht.
    const withoutMatsch = bergpreisWinner({
      numTeams: 2,
      preGameCumulative: [900, 0],
      target: 1058,
      trickPointsPerTrick,
      trickWinnerTeams,
      weisPerTeam: [0, 0],
      stoeckTeam: null,
      matschTeam: -1,
      sackRule: false,
      weisNeedsTrick: false,
    });
    expect(withoutMatsch).toBe(-1);
  });
});

/** Fertiger RoundState mit leeren Tricks (deterministisch: nur letzter Stich +5). */
function finishedState(opts: {
  teams: readonly number[];
  trickWinners: readonly number[];
  weisTeamPoints?: readonly number[];
  sackRule?: boolean;
}): RoundState {
  const base = newRound({
    variant: { mode: "OBEN" },
    announcement: { variant: { mode: "OBEN" }, slalom: false },
    hands: dealCards(seededRng(7)),
    starter: 0,
    teams: opts.teams,
  });
  const dummyTrick = { starter: 0, cards: [] as Card[] };
  const numTeams = Math.max(...opts.teams) + 1;
  return {
    ...base,
    completed_tricks: Array.from({ length: 9 }, () => dummyTrick),
    trick_winners: opts.trickWinners,
    team_card_points: new Array<number>(numTeams).fill(0),
    weisen_team_points: opts.weisTeamPoints ?? new Array<number>(numTeams).fill(0),
    sack_rule: opts.sackRule ?? false,
    weis_needs_trick: false,
    stoeck_announced_team: null,
  };
}

describe("bergpreisWinnerFromState", () => {
  it("erkennt Matsch + letzter-Stich-Bonus (team0 holt alle 9 Stiche)", () => {
    // Leere Tricks: nur der letzte Stich bringt +5 → t0 Karten = 5; +100 Matsch.
    // 900 + 5 + 100 = 1005 ≥ 1000.
    const s = finishedState({ teams: [0, 1, 0, 1], trickWinners: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(bergpreisWinnerFromState(s, [900, 0], 1000)).toBe(0);
  });

  it("Weis-Vorsprung aus weisen_team_points zählt (kein Sack)", () => {
    // t0 gewinnt keinen Stich, hat aber 100 Weis: 950 + 100 = 1050 ≥ 1000
    // bereits vor dem ersten Stich.
    const s = finishedState({
      teams: [0, 1, 0, 1],
      trickWinners: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      weisTeamPoints: [100, 0],
    });
    expect(bergpreisWinnerFromState(s, [950, 0], 1000)).toBe(0);
  });
});
