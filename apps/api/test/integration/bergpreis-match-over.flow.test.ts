/**
 * Integration-Test: Partie-Ende (MATCH_OVER) + Sieg-Modus end-to-end.
 *
 * Verifiziert die Verdrahtung des „Bergpreis"-Features über HTTP + WS:
 *   1. Tisch mit `winMode` erstellen → der View liefert winMode zurück,
 *      `matchWinner` ist anfangs null.
 *   2. Kumulative Partie-Stände knapp unters Ziel seeden (495/495 bei Ziel 500),
 *      damit das gerade laufende Spiel die Partie beendet.
 *   3. Spiel via WS bis zum Ende durchspielen (1 Mensch + 3 Random-KIs).
 *   4. Nach Spielende: Tisch ist MATCH_OVER, der Server hat `matchWinnerTeam`
 *      ermittelt + persistiert, und der View liefert ihn aus.
 *
 * Robuste Assertion (unabhängig vom KI-Spielverlauf): Der Bergpreis-Sieger IST
 * per Definition ein Ziel-Erreicher — also muss sein kumulativer Stand >= Ziel
 * sein. Die exakte „wer zuerst"-Logik prüfen die Engine-Unit-Tests
 * (bergpreis.test.ts / bodensee-bergpreis.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";

import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const SUITS = ["EICHEL", "SCHELLE", "HERZ", "LAUB"] as const;
const RANKS = [
  "SECHS",
  "SIEBEN",
  "ACHT",
  "NEUN",
  "ZEHN",
  "UNTER",
  "OBER",
  "KOENIG",
  "ASS",
] as const;

interface StateUpdate {
  status: "announcing" | "playing" | "finished";
  myTurn: boolean;
  legalActionMask: number[];
  announcement?: { iAmAnnouncer: boolean };
  cut?: { iAmCutter: boolean; deckSize: number };
}

interface TableView {
  status: string;
  winMode: string;
  matchWinner: number | null;
  cumulativeScores: number[];
  targetScore: number;
  currentGameId: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("Bergpreis — Partie-Ende setzt matchWinner (end-to-end)", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  it("erreicht das Ziel → MATCH_OVER + matchWinner ist ein gültiger Ziel-Erreicher", async () => {
    const { http } = await signUpAndIn(app, {
      email: "bergpreis@jass.local",
      password: "bergpreis-passw0rd-12!",
      name: "bergpreis_tester",
    });

    // ─── 1. Tisch (Kreuz, FIRST_TO_TARGET, Ziel 500) mit 3 KIs → Auto-Start ──
    const create = await http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        aiSeatType: "random",
        winMode: "FIRST_TO_TARGET",
        targetScore: 500,
        initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
      }),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const tableId = create.body.tableId;

    // View-Round-Trip: winMode kommt zurück, matchWinner noch null.
    const before = await http.request<TableView>(`/api/lobby/tables/${tableId}`, { method: "GET" });
    expect(before.body.winMode).toBe("FIRST_TO_TARGET");
    expect(before.body.matchWinner).toBeNull();
    const gameId = before.body.currentGameId;
    expect(gameId).not.toBeNull();

    // ─── 2. Kumulative Stände knapp unters Ziel seeden ──────────────────────
    // Beide auf 495 (Ziel 500): das laufende Spiel bringt mind. einen übers Ziel
    // (ein Kreuz-Spiel verteilt ~157 Punkte), also endet die Partie sicher.
    await app.prisma.lobbyTable.update({
      where: { id: tableId },
      data: { cumulativeScoreTeam0: 495, cumulativeScoreTeam1: 495 },
    });

    // ─── 3. Spiel via WS durchspielen ───────────────────────────────────────
    const socket: Socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: http.cookieHeader() },
      reconnection: false,
    });
    let finished = false;
    socket.on("game:state", (s: StateUpdate) => {
      if (s.status === "finished") {
        finished = true;
        return;
      }
      if (s.status === "announcing" && s.cut?.iAmCutter) {
        socket.emit("game:cut", {
          gameId,
          cutIndex: Math.max(1, Math.floor(s.cut.deckSize / 2)),
        });
        return;
      }
      if (s.status === "announcing" && s.announcement?.iAmAnnouncer) {
        socket.emit("game:announce", {
          gameId,
          decision: { kind: "announce", mode: "TRUMPF", trumpSuit: "EICHEL" },
        });
        return;
      }
      if (s.myTurn) {
        const idx = s.legalActionMask.indexOf(1);
        if (idx < 0) return;
        socket.emit("game:move", {
          gameId,
          card: { suit: SUITS[Math.floor(idx / 9)]!, rank: RANKS[idx % 9]! },
        });
      }
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(new Error(`WS connect_error: ${err.message}`)));
      setTimeout(() => reject(new Error("WS connect timeout (5s)")), 5_000);
    });
    socket.emit("game:join", { gameId });

    const deadline = Date.now() + 45_000;
    while (!finished) {
      if (Date.now() > deadline) throw new Error("Game-Loop-Timeout (45s)");
      await sleep(40);
    }
    socket.disconnect();

    // ─── 4. Partie-Ende prüfen ──────────────────────────────────────────────
    // Kurzer Moment, bis handleRoundEnd den Tisch-Status + matchWinner persistiert.
    let after: TableView | null = null;
    const statusDeadline = Date.now() + 5_000;
    while (Date.now() < statusDeadline) {
      const res = await http.request<TableView>(`/api/lobby/tables/${tableId}`, { method: "GET" });
      if (res.body.status === "MATCH_OVER") {
        after = res.body;
        break;
      }
      await sleep(100);
    }

    expect(after, "Tisch erreichte nicht MATCH_OVER").not.toBeNull();
    const view = after!;
    expect(view.winMode).toBe("FIRST_TO_TARGET");
    // Sieger wurde server-seitig ermittelt + persistiert …
    expect(view.matchWinner, "matchWinner nicht gesetzt").not.toBeNull();
    expect([0, 1]).toContain(view.matchWinner);
    // … und ist per Definition ein Ziel-Erreicher: sein Stand >= Ziel.
    const winnerScore = view.cumulativeScores[view.matchWinner!] ?? 0;
    expect(winnerScore).toBeGreaterThanOrEqual(view.targetScore);
  });
});
