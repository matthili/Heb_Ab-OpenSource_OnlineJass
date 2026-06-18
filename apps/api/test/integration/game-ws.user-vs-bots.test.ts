/**
 * Integration-Test: Plan-Doc §11 — End-to-End via WebSocket.
 *
 * Szenario:
 *   1. User registriert sich, verifiziert, loggt ein
 *   2. POST /api/games → Tisch mit User auf Sitz 0, 3 KIs (random) auf 1..3
 *   3. Socket.IO-Client verbindet sich mit Cookie, joint Tisch
 *   4. Bei jedem `myTurn:true` spielt der Client die erste legale Karte
 *   5. KIs ziehen automatisch nach (Gateway-Auto-Step)
 *   6. Spiel endet mit 9 Tricks, finalScore.team_card_points-Summe = 157
 *
 * Was hier zusätzlich zum Service-Loop-Test geprüft wird:
 *   - Cookie-basiertes WS-Auth (game.gateway.ts server.use-Middleware)
 *   - Single-Owner-Lock (GameLockService) serialisiert User-Moves + KI-Loop
 *   - Per-Sitz-State-Filter: User sieht nur seine eigene Hand, niemals fremde
 *   - DB-Persistenz: 36 Moves geschrieben, davon 9 mit der User-ID, 27 ohne
 *
 * Inferenz wird hier NICHT genutzt — `random`-KIs reichen für den
 * Gateway-Pfad. NN-spezifisches kommt in `inference-fallback.test.ts`.
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
  whoseTurnSeat: number;
  hand: { suit: string; rank: string }[];
  legalActionMask: number[];
  state: {
    trick_idx: number;
    completed_tricks: unknown[];
    hands?: unknown[]; // sollte hier NICHT vorhanden sein (server filtert)
  } | null;
  announcement?: {
    announcerSeat: number;
    iAmAnnouncer: boolean;
    canPush: boolean;
    pushedFromSeat: number | null;
  };
  cut?: {
    cutterSeat: number;
    iAmCutter: boolean;
    deckSize: number;
  };
  finalScore?: {
    team_card_points: number[];
    matsch_team: number | null;
    trick_winners: number[];
  };
}

describe("M4 game-ws — 1 User (via WS) + 3 Random-KIs spielen Runde durch", () => {
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

  it("9 Stiche, Punktesumme 157, Hand am Ende leer, 36 Moves in DB", async () => {
    const { http, userId } = await signUpAndIn(app, {
      email: "wstest@jass.local",
      password: "ws-test-passw0rd-12!",
      name: "ws_tester",
    });

    // ─── 1. Tisch öffnen mit 3 KIs → Auto-Start (M6-C) ─────────────────
    // Seit M6-C gibt es keinen direkten Game-Endpoint mehr. Wir öffnen einen
    // Tisch mit drei initialAiSeats; weil damit 4 Sitze sofort voll sind,
    // startet das Spiel beim openTable-Aufruf automatisch.
    const create = await http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        aiSeatType: "random",
        initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
      }),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const tableId = create.body.tableId;
    const tableDetail = await http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    expect(tableDetail.body.currentGameId).not.toBeNull();
    const gameId = tableDetail.body.currentGameId!;

    // ─── 2. WS connect + join ───────────────────────────────────────────
    const socket: Socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: http.cookieHeader() },
      reconnection: false,
    });

    const wsErrors: string[] = [];
    socket.on("game:error", (e: { message: string }) => {
      wsErrors.push(e.message);
    });

    let lastUpdate: StateUpdate | null = null;
    let finished = false;
    let userMovesPlayed = 0;

    socket.on("game:state", (s: StateUpdate) => {
      lastUpdate = s;
      // Filter-Check: der Server darf NICHT die fremden Hände schicken.
      // `state.hands` ist eine Server-interne Eigenschaft, die in der View
      // weggefiltert sein muss.
      if (s.state?.hands !== undefined) {
        // Sammeln statt sofortiges expect, damit der Test ein lesbares
        // Profil produziert, wenn das später mal regrediert.
        wsErrors.push("state.hands ist im WS-Payload sichtbar");
      }
      if (s.status === "finished") {
        finished = true;
        return;
      }
      // Abheben-Phase: bin ich (zufällig) der Abheber, schneide ich
      // deterministisch in der Mitte. Ohne das hängt das Spiel, wenn der Mensch
      // der Abheber ist (Cutter = (announcerSeat + 2) % 4) — der Test sendete
      // sonst nie game:cut und lief in den Timeout.
      if (s.status === "announcing" && s.cut?.iAmCutter) {
        socket.emit("game:cut", {
          gameId,
          cutIndex: Math.max(1, Math.floor(s.cut.deckSize / 2)),
        });
        return;
      }
      // Sprint C: Wenn ich der Ansager bin, sage pragmatisch TRUMPF/EICHEL
      // an (der Test verifiziert das Move-Verhalten, nicht die Strategie).
      if (s.status === "announcing" && s.announcement?.iAmAnnouncer) {
        socket.emit("game:announce", {
          gameId,
          decision: { kind: "announce", mode: "TRUMPF", trumpSuit: "EICHEL" },
        });
        return;
      }
      if (s.myTurn) {
        const idx = s.legalActionMask.indexOf(1);
        if (idx < 0) {
          wsErrors.push("myTurn=true aber legalActionMask leer");
          return;
        }
        const card = {
          suit: SUITS[Math.floor(idx / 9)]!,
          rank: RANKS[idx % 9]!,
        };
        userMovesPlayed++;
        socket.emit("game:move", { gameId, card });
      }
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(new Error(`WS connect_error: ${err.message}`)));
      setTimeout(() => reject(new Error("WS connect timeout (5s)")), 5_000);
    });
    socket.emit("game:join", { gameId });

    // ─── 3. Warten auf Ende ─────────────────────────────────────────────
    // 45 s statt 20 s: unter Voll-Suite-Last (35 Files in EINEM Worker) braucht
    // der WS-Spiel-Loop (Cut + Ansage + 36 Züge × Round-Trip) länger.
    const deadline = Date.now() + 45_000;
    while (!finished) {
      if (Date.now() > deadline) throw new Error("Game-Loop > 20 s — timeout");
      await sleep(40);
    }
    socket.disconnect();

    // ─── 4. Verifikation ────────────────────────────────────────────────
    expect(wsErrors, wsErrors.join("\n")).toEqual([]);
    expect(userMovesPlayed).toBe(9); // genau ein Move pro Trick

    const u = lastUpdate!;
    expect(u.status).toBe("finished");
    expect(u.state).not.toBeNull();
    expect(u.state!.completed_tricks).toHaveLength(9);
    expect(u.state!.trick_idx).toBe(9);
    expect(u.hand).toHaveLength(0);
    expect(u.finalScore).toBeDefined();
    const sum = u.finalScore!.team_card_points.reduce((a, b) => a + b, 0);
    // 157 Grundpunkte + optional Stöck (20) + optional Matsch (100) + optional
    // Weisen (z.B. 20/50/100/150/…). Wir können hier nicht deterministisch
    // wissen, was die Random-KI an Boni gesammelt hat — also Plausibilität:
    // sum ≥ Grundpunkte, < großzügige Obergrenze. (Vorher harte Liste 157/177/
    // 257/277, die Weisen ignorierte → flake, sobald ein Weisen-3er fiel.)
    expect(sum, `unrealistischer Punkte-Sum: ${sum}`).toBeGreaterThanOrEqual(157);
    expect(sum, `unrealistischer Punkte-Sum: ${sum}`).toBeLessThanOrEqual(600);

    // ─── 5. DB-Persistenz ───────────────────────────────────────────────
    const dbMoves = await app.prisma.move.findMany({
      where: { gameId },
      orderBy: { seq: "asc" },
    });
    expect(dbMoves).toHaveLength(36);
    const userMovesInDb = dbMoves.filter((m) => m.userId === userId);
    const aiMovesInDb = dbMoves.filter((m) => m.userId === null);
    expect(userMovesInDb).toHaveLength(9);
    expect(aiMovesInDb).toHaveLength(27);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
