/**
 * Tests für den Disconnect-Vote-Aggregator. Sehr ausführlich, weil das
 * der zentrale Logik-Knoten ist und die Spec sechs Konstellationen +
 * Sonderregeln (Patt-Default, STOP-Veto in VOTE_2, Einstimmigkeit für
 * WAIT_AGAIN, KI-Auto-Vote in 2/1- und 1/n-Setups) abdeckt.
 */
import { describe, expect, it } from "vitest";

import {
  aggregate,
  isWaitAgainAllowed,
  type VoteChoice,
} from "../src/modules/game/disconnect-vote.js";

// Convenience: Sitz-Builder.
const H = (seat: number) => ({ seat, kind: "HUMAN" as const });
const A = (seat: number) => ({ seat, kind: "AI" as const });

const votes = (m: Record<number, VoteChoice>) => m;

describe("Disconnect-Vote — VOTE_1, mehrere Menschen", () => {
  it("Mehrheit STOP → effective STOP, KI stimmt WAIT (1 Mensch will WAIT), Mehrheit zählt aber STOP", () => {
    // 3 Menschen + 1 KI, ein Mensch WAIT → KI stimmt WAIT (Spec).
    // Tally: STOP 2, WAIT 2 (= 1 Mensch + 1 KI), FILL 0.
    // Bei Gleichstand STOP > WAIT → STOP gewinnt (konservative Ordering).
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1), H(2), A(3)],
      humanVotes: votes({ 0: "STOP", 1: "STOP", 2: "WAIT" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
    expect(r.aiAutoVotes).toEqual([{ seat: 3, choice: "WAIT" }]);
  });

  it("Mehrheit WAIT → KI stimmt WAIT mit → WAIT gewinnt deutlicher", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1), A(2), A(3)],
      humanVotes: votes({ 0: "WAIT", 1: "FILL" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("WAIT");
    expect(r.aiAutoVotes).toHaveLength(2);
    expect(r.aiAutoVotes.every((v) => v.choice === "WAIT")).toBe(true);
  });

  it("Patt 1×WAIT, 1×FILL, kein STOP → Default WAIT (Plan-Spec)", () => {
    // 2 Menschen, keine KIs zusätzlich (außer für Mehrheit irrelevant).
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1)],
      humanVotes: votes({ 0: "WAIT", 1: "FILL" }),
      votingClosed: true,
    });
    expect(r.result).toBe("TIE_DEFAULT");
    expect(r.effective).toBe("WAIT");
  });

  it("1v1v1 (STOP/WAIT/FILL) → STOP, weil STOP > WAIT > FILL bei Gleichstand", () => {
    // Hier zählt STOP-Konservativität: bei echter 1:1:1-Verteilung würde
    // die Spec eigentlich "automatisch warten" sagen — aber wenn eine
    // Stimme STOP ist, gilt die Veto-Wahrung. Der TIE_DEFAULT-Pfad oben
    // greift NUR, wenn STOP == 0.
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1), H(2)],
      humanVotes: votes({ 0: "STOP", 1: "WAIT", 2: "FILL" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
  });

  it("1v1 zwischen WAIT und WAIT (alle einig) → WAIT, KI dazu", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1), A(2)],
      humanVotes: votes({ 0: "WAIT", 1: "WAIT" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("WAIT");
    expect(r.aiAutoVotes).toEqual([{ seat: 2, choice: "WAIT" }]);
  });

  it("PENDING wenn noch nicht alle gevotet UND votingClosed=false", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1), H(2)],
      humanVotes: votes({ 0: "WAIT" }),
      votingClosed: false,
    });
    expect(r.result).toBe("PENDING");
    expect(r.effective).toBeNull();
  });

  it("votingClosed=true zwingt zur Auswertung, auch mit Teil-Stimmen", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1), H(2)],
      humanVotes: votes({ 0: "STOP", 1: "STOP" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
  });

  it("Niemand stimmt + Timeout → STOP (alle weg)", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1)],
      humanVotes: votes({}),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
  });
});

describe("Disconnect-Vote — VOTE_1, 2 Menschen + 1 KI", () => {
  it("1×WAIT + 1×FILL → KI stimmt WAIT (mind. 1 Mensch will WAIT) → 2:1 WAIT", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1), A(2)],
      humanVotes: votes({ 0: "WAIT", 1: "FILL" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("WAIT");
    expect(r.aiAutoVotes).toEqual([{ seat: 2, choice: "WAIT" }]);
  });

  it("1×WAIT + 1×STOP → KI stimmt WAIT → 2:1 WAIT (VOTE_1 hat KEIN STOP-Veto)", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1), A(2)],
      humanVotes: votes({ 0: "WAIT", 1: "STOP" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("WAIT");
  });

  it("beide Menschen STOP → KI enthält sich (kein WAIT-Wunsch) → STOP", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), H(1), A(2)],
      humanVotes: votes({ 0: "STOP", 1: "STOP" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
    expect(r.aiAutoVotes).toHaveLength(0);
  });
});

describe("Disconnect-Vote — VOTE_1, 1 Mensch + 2 KIs", () => {
  it("Mensch wählt WAIT → beide KIs stimmen WAIT → einstimmig", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), A(1), A(2)],
      humanVotes: votes({ 0: "WAIT" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("WAIT");
    expect(r.aiAutoVotes).toHaveLength(2);
  });

  it("Mensch wählt STOP → KIs stimmen STOP → einstimmig STOP", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), A(1), A(2)],
      humanVotes: votes({ 0: "STOP" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
    expect(r.aiAutoVotes.every((v) => v.choice === "STOP")).toBe(true);
  });

  it("Mensch stimmt nicht ab + Timeout → STOP (KIs enthalten sich, keine Stimme)", () => {
    const r = aggregate({
      phase: "VOTE_1",
      participants: [H(0), A(1), A(2)],
      humanVotes: votes({}),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
  });
});

describe("Disconnect-Vote — VOTE_2 Einstimmigkeits-Regel", () => {
  it("isWaitAgainAllowed in VOTE_1 immer true", () => {
    expect(isWaitAgainAllowed("VOTE_1", { 0: "STOP", 1: "FILL" })).toBe(true);
  });

  it("isWaitAgainAllowed in VOTE_2 nur wenn alle bisherigen Stimmen WAIT sind", () => {
    expect(isWaitAgainAllowed("VOTE_2", { 0: "WAIT", 1: "WAIT" })).toBe(true);
    expect(isWaitAgainAllowed("VOTE_2", {})).toBe(true); // noch keine andere Stimme
    expect(isWaitAgainAllowed("VOTE_2", { 0: "FILL" })).toBe(false);
    expect(isWaitAgainAllowed("VOTE_2", { 0: "WAIT", 1: "STOP" })).toBe(false);
  });

  it("VOTE_2 einstimmig WAIT (alle Menschen) → effective WAIT", () => {
    const r = aggregate({
      phase: "VOTE_2",
      participants: [H(0), H(1), H(2)],
      humanVotes: votes({ 0: "WAIT", 1: "WAIT", 2: "WAIT" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("WAIT");
  });

  it("VOTE_2 ein FILL bricht Einstimmigkeit → WAIT-Stimmen ignoriert, Mehrheit aus Rest", () => {
    // 2×WAIT + 1×FILL → WAIT nicht einstimmig → WAIT raus aus Tally →
    // 1 FILL übrig → FILL gewinnt.
    const r = aggregate({
      phase: "VOTE_2",
      participants: [H(0), H(1), H(2)],
      humanVotes: votes({ 0: "WAIT", 1: "WAIT", 2: "FILL" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("FILL");
  });
});

describe("Disconnect-Vote — VOTE_2 STOP-Veto", () => {
  it("1×STOP + 1×WAIT → Veto greift, STOP gewinnt", () => {
    const r = aggregate({
      phase: "VOTE_2",
      participants: [H(0), H(1)],
      humanVotes: votes({ 0: "STOP", 1: "WAIT" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
    expect(r.reason).toMatch(/Veto/i);
  });

  it("1×STOP + 1×FILL → Veto greift, STOP gewinnt", () => {
    const r = aggregate({
      phase: "VOTE_2",
      participants: [H(0), H(1)],
      humanVotes: votes({ 0: "STOP", 1: "FILL" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
  });

  it("alle STOP → STOP, kein Veto-Marker (Konsens, kein Konflikt)", () => {
    const r = aggregate({
      phase: "VOTE_2",
      participants: [H(0), H(1)],
      humanVotes: votes({ 0: "STOP", 1: "STOP" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
    expect(r.reason).not.toMatch(/Veto/i);
  });

  it("alle FILL → FILL", () => {
    const r = aggregate({
      phase: "VOTE_2",
      participants: [H(0), H(1)],
      humanVotes: votes({ 0: "FILL", 1: "FILL" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("FILL");
  });
});

describe("Disconnect-Vote — VOTE_2 mit 2 Menschen + 1 KI", () => {
  it("1×FILL + 1×WAIT → KI stimmt FILL (Spec VOTE_2-Präferenz) → WAIT nicht einstimmig → FILL", () => {
    const r = aggregate({
      phase: "VOTE_2",
      participants: [H(0), H(1), A(2)],
      humanVotes: votes({ 0: "FILL", 1: "WAIT" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("FILL");
    expect(r.aiAutoVotes).toEqual([{ seat: 2, choice: "FILL" }]);
  });

  it("1×STOP + 1×FILL → KI stimmt FILL (jemand will FILL) — aber Veto greift → STOP", () => {
    const r = aggregate({
      phase: "VOTE_2",
      participants: [H(0), H(1), A(2)],
      humanVotes: votes({ 0: "STOP", 1: "FILL" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("STOP");
    // KI hat zwar gestimmt, aber Veto-Mechanismus überschreibt.
    expect(r.aiAutoVotes).toHaveLength(1);
  });

  it("beide Menschen FILL → KI stimmt FILL → einstimmig FILL", () => {
    const r = aggregate({
      phase: "VOTE_2",
      participants: [H(0), H(1), A(2)],
      humanVotes: votes({ 0: "FILL", 1: "FILL" }),
      votingClosed: true,
    });
    expect(r.effective).toBe("FILL");
  });
});
