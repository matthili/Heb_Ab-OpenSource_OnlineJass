/**
 * **Reine Vote-Aggregator-Logik für Disconnect-Handling.**
 *
 * Ohne State, ohne Redis, ohne Timer — nur eine Funktion, die aus der
 * Sitz-Zusammensetzung + den menschlichen Votes ein Outcome ableitet.
 * Das ist die Stelle mit den meisten Edge-Cases — eigene Datei, eigene
 * Test-Datei, damit alle Konstellationen abgedeckt sind, ohne ein
 * komplettes Game spinnen zu müssen.
 *
 * **Vote-Choices:**
 *   - `STOP` — Tisch auflösen, alle in die Lobby.
 *   - `WAIT` — Eine weitere Minute auf Reconnect warten (VOTE_1).
 *     In VOTE_2 heißt diese Option semantisch „WAIT_AGAIN" und braucht
 *     **Einstimmigkeit** der menschlichen Stimmen, sonst wird sie für
 *     alle disabled (siehe `isWaitAgainAllowed`).
 *   - `FILL` — Den disconnected Sitz durch eine KI ersetzen, weiter spielen.
 *
 * **Veto-Regel (für VOTE_2):** Hat ein Mensch `STOP` gewählt UND ein
 * anderer eine „weiterspielen"-Option (`WAIT`/`FILL`), wird der Tisch
 * geschlossen — niemand soll gegen seinen Willen weitergezwungen
 * werden. Wer wirklich weiter will, kann das nach der Lobby in einem
 * neuen Tisch tun. In VOTE_1 ist die Veto-Regel weicher: alle weiteren
 * Optionen werden noch zur Diskussion gegeben, der STOP-Wähler kann sich
 * in dieser Zeit auch via Chat überreden lassen.
 *
 * **KI-Stimmen** in der 2/1-Konstellation (2 Menschen + 1 KI):
 *   - VOTE_1: KI stimmt `WAIT`, **sofern mind. 1 Mensch WAIT gewählt hat**.
 *     Sonst zählt die KI nicht mit (Enthaltung).
 *   - VOTE_2: KI stimmt `FILL`, **sofern mind. 1 Mensch FILL gewählt hat**.
 *     Sonst Enthaltung.
 *
 * **KI-Stimmen** in der 1/n-Konstellation (1 Mensch + n KIs):
 *   - Alle KIs stimmen genau das, was der Mensch stimmt — der Mensch
 *     entscheidet de facto alleine.
 */

export type VoteChoice = "STOP" | "WAIT" | "FILL";
export type VotePhase = "VOTE_1" | "VOTE_2";

export interface VoteParticipant {
  /** Sitz-Index 0..3. */
  readonly seat: number;
  /** Spieler-Typ AN DIESEM SITZ — nicht zu verwechseln mit „disconnected". */
  readonly kind: "HUMAN" | "AI";
}

/**
 * Ergebnis der Auswertung.
 *
 * `result`:
 *   - `"STOP"`        — Mehrheit/Veto: Tisch auflösen
 *   - `"WAIT"`        — eine weitere Minute warten
 *   - `"FILL"`        — disconnected Sitz wird KI, Spiel läuft weiter
 *   - `"PENDING"`     — noch nicht alle menschlichen Stimmen da, weiter warten
 *   - `"TIE_DEFAULT"` — nur in VOTE_1: kein STOP, aber Patt zwischen
 *                       WAIT und FILL → Default ist WAIT (Plan-Spec).
 */
export interface VoteOutcome {
  readonly result: "STOP" | "WAIT" | "FILL" | "PENDING" | "TIE_DEFAULT";
  /** Effektive Wahl, die der Caller anwendet (STOP/WAIT/FILL). Bei PENDING undefined. */
  readonly effective: "STOP" | "WAIT" | "FILL" | null;
  /** Erläuterung für AuditLog + Chat-System-Nachricht. */
  readonly reason: string;
  /**
   * Effektive Stimmenverteilung (inkl. KI-Auto-Votes), für Chat-Anzeige
   * und Audit. Mensch-Sitze ohne abgegebene Stimme tauchen NICHT auf.
   */
  readonly tally: Readonly<Record<VoteChoice, number>>;
  /** KI-Sitze, deren Stimme automatisch vergeben wurde, mit ihrer Wahl. */
  readonly aiAutoVotes: ReadonlyArray<{ seat: number; choice: VoteChoice }>;
}

export interface AggregateInput {
  readonly phase: VotePhase;
  /** Alle verbliebenen Sitze (Disconnect-Sitze NICHT enthalten). */
  readonly participants: readonly VoteParticipant[];
  /** Stimmen der menschlichen Sitze (Sitz → Choice). Fehlende = noch nicht abgegeben. */
  readonly humanVotes: Readonly<Record<number, VoteChoice>>;
  /** True wenn die 15 s Vote-Frist abgelaufen ist (zwingt zur Auswertung mit dem, was da ist). */
  readonly votingClosed: boolean;
}

/**
 * Wichtige Hilfsfunktion für die UI: ist `WAIT` in VOTE_2 noch wählbar?
 *
 * Regel: sobald *irgendein* Mensch eine andere Option als `WAIT` gewählt
 * hat, wird `WAIT` für alle gesperrt (auch für Sitze, die noch nicht
 * gewählt haben). Diese Funktion ist pur und kann sowohl Backend als
 * auch Frontend nutzen, damit beide das gleiche disabled-Verhalten
 * zeigen.
 *
 * In VOTE_1 ist immer alles wählbar — die Einstimmigkeits-Regel greift
 * nur in VOTE_2.
 */
export function isWaitAgainAllowed(
  phase: VotePhase,
  humanVotes: Readonly<Record<number, VoteChoice>>
): boolean {
  if (phase !== "VOTE_2") return true;
  return !Object.values(humanVotes).some((v) => v !== "WAIT");
}

export function aggregate(input: AggregateInput): VoteOutcome {
  const humanSeats = input.participants.filter((p) => p.kind === "HUMAN");
  const aiSeats = input.participants.filter((p) => p.kind === "AI");

  // 1. Menschliche Stimmen sammeln (nur valid Sitze).
  const humanVoteList: VoteChoice[] = [];
  const humanVotedSeats = new Set<number>();
  for (const seatId in input.humanVotes) {
    const seat = Number(seatId);
    if (!humanSeats.some((p) => p.seat === seat)) continue; // fremder Sitz, ignorieren
    const v = input.humanVotes[seat]!;
    humanVoteList.push(v);
    humanVotedSeats.add(seat);
  }

  // 2. Sind wir „pending" oder können wir bereits auswerten?
  //
  //   - VOTE_1: warten bis alle Menschen abgestimmt haben ODER bis das
  //     Voting-Fenster geschlossen ist (Timeout).
  //   - VOTE_2: gleiche Regel. Die Einstimmigkeits-Anforderung von
  //     WAIT_AGAIN wird *nach* der Auswertung geprüft.
  const allHumansVoted = humanVotedSeats.size === humanSeats.length;
  if (!allHumansVoted && !input.votingClosed) {
    return {
      result: "PENDING",
      effective: null,
      reason: `Warten auf Stimmen (${humanVotedSeats.size}/${humanSeats.length}).`,
      tally: countVotes(humanVoteList),
      aiAutoVotes: [],
    };
  }

  // 3. KI-Auto-Votes berechnen.
  const humansAlone = humanSeats.length === 1;
  const aiAutoVotes: Array<{ seat: number; choice: VoteChoice }> = [];

  if (humansAlone && humanVoteList.length > 0) {
    // 1 Mensch + N KIs: KIs stimmen alle so wie der eine Mensch.
    const humanChoice = humanVoteList[0]!;
    for (const ai of aiSeats) aiAutoVotes.push({ seat: ai.seat, choice: humanChoice });
  } else if (!humansAlone && aiSeats.length > 0) {
    // ≥ 2 Menschen + KIs: phasen-spezifische KI-Präferenz.
    // VOTE_1 → KI stimmt WAIT, falls mind. 1 Mensch WAIT gewählt hat.
    // VOTE_2 → KI stimmt FILL, falls mind. 1 Mensch FILL gewählt hat.
    const preferredAiChoice: VoteChoice = input.phase === "VOTE_1" ? "WAIT" : "FILL";
    const someoneWantsIt = humanVoteList.some((v) => v === preferredAiChoice);
    if (someoneWantsIt) {
      for (const ai of aiSeats) aiAutoVotes.push({ seat: ai.seat, choice: preferredAiChoice });
    }
    // Sonst: KI enthält sich.
  }

  // 4. Gesamt-Tally.
  const fullList: VoteChoice[] = [...humanVoteList, ...aiAutoVotes.map((v) => v.choice)];
  const tally = countVotes(fullList);

  // 5. VOTE_2 Spezial-Regel: WAIT_AGAIN nur bei *menschlicher* Einstimmigkeit.
  //    Wenn das nicht erfüllt ist, fallen WAIT-Stimmen aus der Bewertung
  //    (= werden als „Enthaltung" behandelt). Die KI-Stimmen bleiben.
  let effectiveHumanVoteList = humanVoteList;
  if (input.phase === "VOTE_2" && !isWaitAgainAllowed("VOTE_2", input.humanVotes)) {
    effectiveHumanVoteList = humanVoteList.filter((v) => v !== "WAIT");
    // KI-Auto-Votes bleiben unangetastet — die folgten der Mensch-Mehrheits-
    // Logik und sind im VOTE_2 auf FILL ausgerichtet, nicht auf WAIT.
  }

  // 6. STOP-Veto in VOTE_2: hat ein Mensch STOP gewählt UND ein anderer
  //    eine Weiter-Option (WAIT/FILL)?
  //    Wichtig: KI-Stimmen zählen hier nicht als „weiterspielen-Wunsch" —
  //    der Veto-Mechanismus schützt nur menschliche Spieler.
  if (input.phase === "VOTE_2") {
    const humanHasStop = humanVoteList.includes("STOP");
    const humanHasContinue = humanVoteList.some((v) => v === "WAIT" || v === "FILL");
    if (humanHasStop && humanHasContinue) {
      return {
        result: "STOP",
        effective: "STOP",
        reason: "STOP-Veto: ein Spieler will aufhören, kann nicht überstimmt werden.",
        tally,
        aiAutoVotes,
      };
    }
  }

  // 7. Niemand gestimmt → Tisch zu (auch alle Menschen weg).
  if (effectiveHumanVoteList.length === 0 && aiAutoVotes.length === 0) {
    return {
      result: "STOP",
      effective: "STOP",
      reason: "Keine Stimmen abgegeben — Tisch wird aufgelöst.",
      tally,
      aiAutoVotes,
    };
  }

  // 8. Mehrheits-Auswertung mit dem effektiven Voting-Material (Mensch
  //    + KI-Auto-Vote).
  const fullEffective: VoteChoice[] = [
    ...effectiveHumanVoteList,
    ...aiAutoVotes.map((v) => v.choice),
  ];
  const effectiveTally = countVotes(fullEffective);

  // VOTE_1 Patt-Regel: bei 1×WAIT + 1×FILL + 0×STOP (oder Verallgemeinerung:
  // STOP-Anteil 0, WAIT-Anteil == FILL-Anteil) → Default WAIT.
  if (input.phase === "VOTE_1") {
    if (
      effectiveTally.STOP === 0 &&
      effectiveTally.WAIT > 0 &&
      effectiveTally.WAIT === effectiveTally.FILL
    ) {
      return {
        result: "TIE_DEFAULT",
        effective: "WAIT",
        reason: "Unentschieden zwischen WAIT und FILL — Default ist WAIT (1 Minute warten).",
        tally,
        aiAutoVotes,
      };
    }
  }

  // Mehrheits-Auswahl: höchste Stimmen-Zahl gewinnt.
  // Bei mehreren Choices mit gleicher Stimmen-Zahl wählen wir
  // konservativ STOP > WAIT > FILL (auflösung vor weiter, warten vor
  // KI-Übernahme). Das schützt den Wunsch zum Aufhören am stärksten.
  const order: VoteChoice[] = ["STOP", "WAIT", "FILL"];
  let best: VoteChoice = "STOP";
  let bestCount = -1;
  for (const c of order) {
    if (effectiveTally[c] > bestCount) {
      best = c;
      bestCount = effectiveTally[c];
    }
  }

  return {
    result: best,
    effective: best,
    reason: reasonFor(best, effectiveTally, input.phase),
    tally,
    aiAutoVotes,
  };
}

function countVotes(list: readonly VoteChoice[]): Record<VoteChoice, number> {
  const out: Record<VoteChoice, number> = { STOP: 0, WAIT: 0, FILL: 0 };
  for (const v of list) out[v]++;
  return out;
}

function reasonFor(
  result: VoteChoice,
  tally: Record<VoteChoice, number>,
  phase: VotePhase
): string {
  const t = `(STOP ${tally.STOP}, WAIT ${tally.WAIT}, FILL ${tally.FILL})`;
  switch (result) {
    case "STOP":
      return `Mehrheit für Auflösen ${t}.`;
    case "WAIT":
      return phase === "VOTE_1"
        ? `Mehrheit für Warten (1 Min) ${t}.`
        : `Einstimmig für weitere 1 Min Warten ${t}.`;
    case "FILL":
      return `Mehrheit für Weiterspielen mit KI ${t}.`;
  }
}
