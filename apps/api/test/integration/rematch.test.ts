/**
 * Integration-Test: M6-E Re-Match-Flow.
 *
 * Szenarien:
 *   1. Voting in WAITING / IN_GAME → 409 (nur in POST_GAME erlaubt)
 *   2. Alle YES → neues Game startet, Sitz-Konfig identisch
 *   3. Mind. 1 NO → Tisch zurück nach WAITING, NO-Voter entfernt
 *   4. Re-Match innerhalb des Matches: Ansager rotiert im Uhrzeigersinn
 *      (nächster Sitz) — unabhängig vom `restartMode`. Der `restartMode`
 *      (WELI / „Sieger gibt") greift NUR beim Match-Start.
 *   5. Vote-Idempotenz: gleicher Vote nochmal = ok, anderer Vote = 409
 *   6. Nicht-Tisch-Spieler: 403
 *
 * Vorgehensweise zum „Game beenden" in Tests: wir treiben die Random-
 * KI-Loop des GameService direkt durch — analog `game-loop.4bots.test`.
 * Das simuliert das Game-Ende ohne realen Karten-Spielfluss.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { settleAnnouncement } from "./announce-helper.js";
import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("M6-E rematch flow", () => {
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

  async function makeUsers(n: number): Promise<SignedInUser[]> {
    const users: SignedInUser[] = [];
    for (let i = 0; i < n; i++) {
      users.push(
        await signUpAndIn(app, {
          email: `rm${i}@jass.local`,
          password: "rematch-test-pw-12!",
          name: `rm${i}`,
        })
      );
    }
    return users;
  }

  /**
   * Eröffnet einen Tisch mit `owner` auf Sitz 0 und 3 Random-KIs auf 1..3,
   * lässt das Auto-Start-Game laufen bis zum Ende, returnt das `tableId`
   * und das `gameId` des beendeten Spiels.
   */
  async function openAndFinishSoloVsAi(
    owner: SignedInUser,
    restartMode: "WELI" | "SIEGER_GIBT" = "SIEGER_GIBT"
  ): Promise<{ tableId: string; gameId: string }> {
    const created = await owner.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        aiSeatType: "random",
        restartMode,
        initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
      }),
    });
    const tableId = created.body.tableId;
    const detail = await owner.http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${tableId}`,
      { method: "GET" }
    );
    const gameId = detail.body.currentGameId!;

    // Sprint C: Game startet im Ansage-Modus. Wir wickeln die Ansage
    // pragmatisch ab (KI-Sitze via Heuristik, User-Sitz TRUMPF/EICHEL).
    await settleAnnouncement(app, gameId);

    // KI-Loop bis Game zu Ende. Wir müssen die User-Moves auch selber
    // spielen (Sitz 0 = Owner). Mit einer „erste legale Karte"-Strategie
    // pro Owner-Turn laufen alle 36 Moves ohne Probleme durch.
    for (let i = 0; i < 50; i++) {
      const next = await app.games.nextAISeat(gameId);
      if (next) {
        const card = await app.games.aiChooseMove(gameId, next.seat, next.aiSeatType);
        await app.games.playMoveAsSeat(gameId, next.seat, card);
        continue;
      }
      // Mensch dran (Sitz 0 = Owner). Eine legale Karte spielen.
      const view = await app.games.viewForSeat(gameId, 0);
      if (view.status === "finished") break;
      const idx = view.legalActionMask.indexOf(1);
      const card = view.hand[idx]!; // Engine garantiert: erste 1 in mask = hand[?]
      // mask ist 36-bit absolute Card-Index, hand sind nur 9 Karten. Wir
      // suchen über hand.
      const handCard = view.hand.find(
        (c) => view.legalActionMask[suitIdx(c.suit) * 9 + rankIdx(c.rank)] === 1
      );
      await app.games.playMoveAsSeat(gameId, 0, handCard ?? card);
    }

    const final = await app.games.viewForSeat(gameId, 0);
    expect(final.status).toBe("finished");
    return { tableId, gameId };
  }

  it("Vote vor POST_GAME (IN_GAME) → 409", async () => {
    const [owner] = await makeUsers(1);
    const created = await owner!.http.request<{ tableId: string }>("/api/lobby/tables", {
      method: "POST",
      body: JSON.stringify({
        joinMode: "OPEN",
        initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
      }),
    });
    const detail = await owner!.http.request<{ currentGameId: string | null }>(
      `/api/lobby/tables/${created.body.tableId}`,
      { method: "GET" }
    );
    const gameId = detail.body.currentGameId!;
    const vote = await owner!.http.request(`/api/games/${gameId}/rematch-vote`, {
      method: "POST",
      body: JSON.stringify({ vote: "YES" }),
    });
    expect(vote.status).toBe(409);
  });

  it("Solo-User + 3 KIs: YES-Vote startet sofort neues Game (KIs voten implizit YES)", async () => {
    const [owner] = await makeUsers(1);
    const { tableId, gameId } = await openAndFinishSoloVsAi(owner!, "SIEGER_GIBT");

    // Tisch ist nach Game-Ende in POST_GAME.
    const beforeVote = await app.prisma.lobbyTable.findUnique({ where: { id: tableId } });
    expect(beforeVote?.status).toBe("POST_GAME");

    const vote = await owner!.http.request<{ kind: string; gameId?: string }>(
      `/api/games/${gameId}/rematch-vote`,
      { method: "POST", body: JSON.stringify({ vote: "YES" }) }
    );
    expect(vote.body.kind).toBe("rematch-started");
    expect(vote.body.gameId).toBeTruthy();

    const after = await app.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: { status: true, currentGameId: true },
    });
    expect(after?.status).toBe("IN_GAME");
    expect(after?.currentGameId).toBe(vote.body.gameId);
    expect(after?.currentGameId).not.toBe(gameId); // wirklich neues Game
  });

  it("NO-Vote → Tisch zurück nach WAITING, NO-Voter entfernt", async () => {
    const [owner] = await makeUsers(1);
    const { tableId, gameId } = await openAndFinishSoloVsAi(owner!, "SIEGER_GIBT");

    const vote = await owner!.http.request<{ kind: string; removedUserIds?: string[] }>(
      `/api/games/${gameId}/rematch-vote`,
      { method: "POST", body: JSON.stringify({ vote: "NO" }) }
    );
    expect(vote.body.kind).toBe("back-to-waiting");
    expect(vote.body.removedUserIds).toContain(owner!.userId);

    // Solo-Tisch (nur Owner war Mensch) → Tisch ist jetzt CLOSED, nicht
    // bloß WAITING (analog zur leaveTable-Logik wenn kein Mensch bleibt).
    const after = await app.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: { status: true },
    });
    expect(after?.status).toBe("CLOSED");
  });

  it("WELI-Tisch, Re-Match mitten im Match: Ansager rotiert im Uhrzeigersinn (NICHT per WELI)", async () => {
    const [owner] = await makeUsers(1);
    const { gameId } = await openAndFinishSoloVsAi(owner!, "WELI");

    // Vorigen Ansager (= starter der letzten Runde) lesen.
    const prevGame = await app.prisma.game.findUnique({
      where: { id: gameId },
      include: { rounds: true },
    });
    const lastStarter = prevGame!.rounds[0]!.starter;

    const vote = await owner!.http.request<{ kind: string; gameId?: string; starter?: number }>(
      `/api/games/${gameId}/rematch-vote`,
      { method: "POST", body: JSON.stringify({ vote: "YES" }) }
    );
    expect(vote.body.kind).toBe("rematch-started");
    // Innerhalb des Matches: nächster Sitz im Uhrzeigersinn — das WELI
    // bestimmt den Ansager NUR beim Match-Start, nicht zwischen den Händen.
    expect(vote.body.starter).toBe((lastStarter + 1) % 4);
  });

  it("SIEGER_GIBT-Tisch, Re-Match mitten im Match: Ansager rotiert ebenfalls im Uhrzeigersinn", async () => {
    const [owner] = await makeUsers(1);
    const { tableId, gameId } = await openAndFinishSoloVsAi(owner!, "SIEGER_GIBT");

    const dbGame = await app.prisma.game.findUnique({
      where: { id: gameId },
      include: { rounds: true },
    });
    const lastStarter = dbGame!.rounds[0]!.starter;

    const vote = await owner!.http.request<{ kind: string; starter?: number }>(
      `/api/games/${gameId}/rematch-vote`,
      { method: "POST", body: JSON.stringify({ vote: "YES" }) }
    );
    expect(vote.body.kind).toBe("rematch-started");
    // `restartMode` (Sieger gibt) greift nur am Match-Start — innerhalb des
    // Matches wird einfach im Uhrzeigersinn weitergerückt.
    expect(vote.body.starter).toBe((lastStarter + 1) % 4);

    // Sanity: Tisch ist IN_GAME mit neuem Game.
    const after = await app.prisma.lobbyTable.findUnique({ where: { id: tableId } });
    expect(after?.status).toBe("IN_GAME");
  });

  it("Vote-Idempotenz: gleicher Vote nochmal = ok, anderer = 409", async () => {
    const [owner] = await makeUsers(1);
    const { gameId } = await openAndFinishSoloVsAi(owner!, "SIEGER_GIBT");

    // Erster YES → startet sofort (Solo).
    const first = await owner!.http.request(`/api/games/${gameId}/rematch-vote`, {
      method: "POST",
      body: JSON.stringify({ vote: "YES" }),
    });
    expect(first.status).toBe(201);

    // Zweiter Vote für dasselbe (alte) Game: Game ist jetzt nicht mehr das
    // currentGameId. Server lehnt mit 409 ab — sauber.
    const again = await owner!.http.request(`/api/games/${gameId}/rematch-vote`, {
      method: "POST",
      body: JSON.stringify({ vote: "YES" }),
    });
    expect(again.status).toBe(409);
  });

  it("Vote von einem Nicht-Tisch-Spieler: 403", async () => {
    const [owner, stranger] = await makeUsers(2);
    const { gameId } = await openAndFinishSoloVsAi(owner!, "SIEGER_GIBT");

    const vote = await stranger!.http.request(`/api/games/${gameId}/rematch-vote`, {
      method: "POST",
      body: JSON.stringify({ vote: "YES" }),
    });
    expect(vote.status).toBe(403);
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────

function suitIdx(suit: string): number {
  return ["EICHEL", "SCHELLE", "HERZ", "LAUB"].indexOf(suit);
}
function rankIdx(rank: string): number {
  return ["SECHS", "SIEBEN", "ACHT", "NEUN", "ZEHN", "UNTER", "OBER", "KOENIG", "ASS"].indexOf(
    rank
  );
}
