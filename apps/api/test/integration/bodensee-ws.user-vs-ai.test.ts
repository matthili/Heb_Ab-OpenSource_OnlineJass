/**
 * Integration-Test: Bodensee-Jass End-to-End via WebSocket.
 *
 * Szenario:
 *   1. User registriert sich, verifiziert, loggt ein
 *   2. POST /api/lobby/tables → BODENSEE_2P-Tisch, User auf Sitz 0,
 *      eine KI auf Sitz 1 → Tisch ist 2-voll → Auto-Start
 *   3. Socket.IO-Client verbindet sich mit Cookie, joint via `bodensee:join`
 *   4. Ist der User Ansager → `bodensee:announce` (TRUMPF/EICHEL);
 *      sonst übernimmt die KI-Loop die Ansage
 *   5. Bei jedem `myTurn:true` spielt der Client die erste legale Karte
 *   6. Die KI zieht automatisch nach (driveBodenseeAIsLoop im Gateway)
 *   7. Spiel endet nach 18 Stichen mit `finalScore` für 2 Spieler
 *
 * Was hier geprüft wird:
 *   - Der eigene `bodensee:*`-WS-Pfad (join/announce/move) im GameGateway
 *   - driveBodenseeAIsLoop treibt Ansage + KI-Züge bis zum Spielende
 *   - Lobby startet einen BODENSEE_2P-Tisch über BodenseeGameService
 *   - DB-Persistenz: 36 Moves (18 Stiche × 2), 18 mit User-ID, 18 ohne
 *   - Re-Match: nach Spielende startet ein YES-Vote ein frisches Game
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

interface BodenseeState {
  status: "announcing" | "playing" | "finished";
  myTurn: boolean;
  whoseTurnSeat: number;
  hand: { suit: string; rank: string }[];
  legalActionMask: number[];
  trickIdx: number;
  announcement?: { announcerSeat: number; iAmAnnouncer: boolean };
  finalScore?: { player_total_points: number[]; matsch_player: number | null };
}

describe("Bodensee-ws — 1 User (via WS) + 1 KI spielen eine Partie durch", () => {
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

  it("18 Stiche, finalScore, 36 Moves in DB — danach Re-Match", async () => {
    const { http, userId } = await signUpAndIn(app, {
      email: "bodensee-ws@jass.local",
      password: "bodensee-test-passw0rd-12!",
      name: "bodensee_tester",
    });

    // ─── 1. BODENSEE_2P-Tisch öffnen → mit einer KI sofort 2-voll ───────
    const create = await http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        variant: "BODENSEE_2P",
        aiSeatType: "random",
        initialAiSeats: [{ seat: 1 }],
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
    socket.on("bodensee:error", (e: { message: string }) => {
      wsErrors.push(e.message);
    });

    let lastState: BodenseeState | null = null;
    let endedPayload: { finalScore?: BodenseeState["finalScore"] } | null = null;
    let finished = false;
    let announced = false;
    let userMovesPlayed = 0;

    socket.on("bodensee:ended", (p: { finalScore?: BodenseeState["finalScore"] }) => {
      endedPayload = p;
    });

    socket.on("bodensee:state", (s: BodenseeState) => {
      lastState = s;
      if (s.status === "finished") {
        finished = true;
        return;
      }
      // Ansage-Phase: bin ich der Ansager, sage ich pragmatisch TRUMPF/EICHEL
      // an (der Test prüft den Loop, nicht die Ansage-Strategie).
      if (s.status === "announcing") {
        if (s.announcement?.iAmAnnouncer && !announced) {
          announced = true;
          socket.emit("bodensee:announce", {
            gameId,
            announcement: { variant: { mode: "TRUMPF", trump_suit: "EICHEL" }, slalom: false },
          });
        }
        return;
      }
      // Spielphase: bei eigenem Zug erste legale Karte spielen.
      if (s.myTurn) {
        const idx = s.legalActionMask.indexOf(1);
        if (idx < 0) {
          wsErrors.push("myTurn=true aber legalActionMask leer");
          return;
        }
        const card = { suit: SUITS[Math.floor(idx / 9)]!, rank: RANKS[idx % 9]! };
        userMovesPlayed++;
        socket.emit("bodensee:move", { gameId, card });
      }
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(new Error(`WS connect_error: ${err.message}`)));
      setTimeout(() => reject(new Error("WS connect timeout (5s)")), 5_000);
    });
    socket.emit("bodensee:join", { gameId });

    // ─── 3. Warten auf Spielende ────────────────────────────────────────
    const deadline = Date.now() + 30_000;
    while (!finished) {
      if (Date.now() > deadline) throw new Error("Bodensee-Loop > 30 s — timeout");
      await sleep(40);
    }
    socket.disconnect();

    // ─── 4. Verifikation ────────────────────────────────────────────────
    expect(wsErrors, wsErrors.join("\n")).toEqual([]);
    expect(userMovesPlayed).toBe(18); // genau ein eigener Zug pro Stich

    const s = lastState!;
    expect(s.status).toBe("finished");
    expect(s.hand).toHaveLength(0);
    expect(s.trickIdx).toBe(18);
    expect(s.finalScore).toBeDefined();
    expect(s.finalScore!.player_total_points).toHaveLength(2);
    // `bodensee:ended` muss mit demselben finalScore gefeuert haben.
    expect(endedPayload).not.toBeNull();
    expect(endedPayload!.finalScore?.player_total_points).toHaveLength(2);

    // ─── 5. DB-Persistenz ───────────────────────────────────────────────
    const dbMoves = await app.prisma.move.findMany({
      where: { gameId },
      orderBy: { seq: "asc" },
    });
    expect(dbMoves).toHaveLength(36); // 18 Stiche × 2 Spieler
    expect(dbMoves.filter((m) => m.userId === userId)).toHaveLength(18);
    expect(dbMoves.filter((m) => m.userId === null)).toHaveLength(18);

    // ─── 6. Re-Match ────────────────────────────────────────────────────
    // Tisch steht nach Spielende auf POST_GAME. Der einzige Mensch votet
    // YES → das Backend startet sofort ein frisches Bodensee-Game.
    const rematch = await http.request<{ kind: string; gameId?: string }>(
      `/api/games/${gameId}/rematch-vote`,
      { method: "POST", body: JSON.stringify({ vote: "YES" }) }
    );
    expect(rematch.status, JSON.stringify(rematch.body)).toBeLessThan(300);
    expect(rematch.body.kind).toBe("rematch-started");
    expect(rematch.body.gameId).toBeTruthy();
    expect(rematch.body.gameId).not.toBe(gameId);

    // Der Tisch zeigt jetzt auf das neue Game und ist wieder IN_GAME.
    const afterRematch = await http.request<{ currentGameId: string | null; status: string }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    expect(afterRematch.body.currentGameId).toBe(rematch.body.gameId);
    expect(afterRematch.body.status).toBe("IN_GAME");
  });

  it("Disconnect mitten im Spiel — KI übernimmt, das Spiel läuft zu Ende", async () => {
    const { http, userId } = await signUpAndIn(app, {
      email: "bodensee-dc@jass.local",
      password: "bodensee-dc-passw0rd-12!",
      name: "bodensee_dc",
    });

    const create = await http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        variant: "BODENSEE_2P",
        aiSeatType: "random",
        initialAiSeats: [{ seat: 1 }],
      }),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const tableId = create.body.tableId;

    const tableDetail = await http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    const gameId = tableDetail.body.currentGameId!;
    expect(gameId).toBeTruthy();

    // WS verbinden, joinen — dann die Verbindung hart kappen.
    const socket: Socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: http.cookieHeader() },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(new Error(`WS connect_error: ${err.message}`)));
      setTimeout(() => reject(new Error("WS connect timeout (5s)")), 5_000);
    });
    socket.emit("bodensee:join", { gameId });
    await sleep(300);
    socket.disconnect();

    // Nach dem Disconnect wird der Sitz KI-ersetzt; dann sind beide Sitze
    // KI und die KI-Loop spielt das Spiel zu Ende.
    const deadline = Date.now() + 30_000;
    let ended = false;
    while (Date.now() < deadline) {
      const g = await app.prisma.game.findUnique({
        where: { id: gameId },
        select: { endedAt: true },
      });
      if (g?.endedAt) {
        ended = true;
        break;
      }
      await sleep(300);
    }
    expect(ended, "Spiel sollte nach Disconnect von der KI beendet werden").toBe(true);

    const moves = await app.prisma.move.count({ where: { gameId } });
    expect(moves).toBe(36);

    // Der Sitz des getrennten Users ist als KI-ersetzt markiert.
    const seat = await app.prisma.gameSeat.findFirst({
      where: { gameId, userId },
      select: { replacedByAiSeatType: true },
    });
    expect(seat?.replacedByAiSeatType).toBeTruthy();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
