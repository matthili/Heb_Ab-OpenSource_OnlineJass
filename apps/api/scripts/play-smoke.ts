#!/usr/bin/env tsx
/**
 * play:smoke — "Done-when"-Test für M4.
 *
 * Lauf: `pnpm play:smoke` (im Repo-Root) oder
 *       `pnpm --filter @jass/api exec tsx scripts/play-smoke.ts`
 *
 * Was passiert:
 *   1. HTTP sign-in als matthias_test
 *   2. POST /api/games mit Sitz 0 = matthias_test, Sitze 1..3 = Random-KI
 *   3. WS connect → game:join → WS triggert KEINE Auto-Step für Sitz 0
 *      (das ist der User-Sitz)
 *   4. Loop: bei jedem "myTurn=true" spielt der Skript-Client zufällig eine
 *      legale Karte → KIs auf Sitz 1..3 ziehen automatisch nach
 *   5. Wenn `status === "finished"` → finalScore loggen, Erfolg prüfen
 *
 * Erfolgs-Kriterien:
 *   - Genau 9 Tricks gespielt
 *   - Eigene Hand leer
 *   - team_card_points-Summe = 157 (= 152 + 5 letzter-Stich-Bonus, kein Matsch)
 */
import { io, type Socket } from "socket.io-client";

const API_URL = process.env["API_URL"] ?? "http://localhost:3000";
const EMAIL = "matthias@jass.local";
const PASSWORD = "my-secret-passw0rd!";
// `random` (Default) oder `nn` für echte NN-KI über den Inferenz-Service.
const AI_TYPE = process.env["AI_TYPE"] ?? "random";

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
  status: "playing" | "finished";
  myTurn: boolean;
  whoseTurnSeat: number;
  hand: { suit: string; rank: string }[];
  legalActionMask: number[];
  state: { trick_idx: number; completed_tricks: unknown[] };
  finalScore?: {
    team_card_points: number[];
    matsch_team: number | null;
    trick_winners: number[];
  };
}

async function main(): Promise<void> {
  console.info(`=== Smoke: 1× User + 3× ${AI_TYPE.toUpperCase()}-KI, eine komplette Runde ===`);

  // 1) HTTP sign-in
  const loginRes = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: API_URL },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`sign-in failed: ${loginRes.status}`);
  const cookieHeader = loginRes.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  // 2) Tisch öffnen — Spielstart erfolgt automatisch, weil wir direkt mit
  //    3 KI-Sitzen aufmachen (4-voll-Trigger seit M6-C).
  const createRes = await fetch(`${API_URL}/api/lobby/tables`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: API_URL,
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      joinMode: "OPEN",
      aiSeatType: AI_TYPE,
      initialAiSeats: [{ seat: 1 }, { seat: 2 }, { seat: 3 }],
    }),
  });
  if (!createRes.ok) {
    throw new Error(`open-table failed: ${createRes.status} ${await createRes.text()}`);
  }
  const { tableId } = (await createRes.json()) as { tableId: string };

  // currentGameId aus der Tisch-Detail-View ziehen.
  const detailRes = await fetch(`${API_URL}/api/lobby/tables/${tableId}`, {
    headers: { Cookie: cookieHeader },
  });
  if (!detailRes.ok) {
    throw new Error(`table-detail failed: ${detailRes.status} ${await detailRes.text()}`);
  }
  const detail = (await detailRes.json()) as { currentGameId: string | null };
  if (!detail.currentGameId) {
    throw new Error("Tisch hat keine currentGameId — Auto-Start hat nicht gefeuert?");
  }
  const gameId = detail.currentGameId;
  console.info(`  Tisch ${tableId} → Game ${gameId}`);

  // 3) WS connect + join
  const socket: Socket = io(API_URL, {
    path: "/ws",
    transports: ["websocket"],
    extraHeaders: { Cookie: cookieHeader },
    auth: {},
    reconnection: false,
  });

  socket.on("game:error", (e: { message: string }) => {
    console.error("  [WS-ERR]", e.message);
  });

  let lastUpdate: StateUpdate | null = null;
  let finished = false;
  let humanMovesPlayed = 0;

  socket.on("game:state", (s: StateUpdate) => {
    lastUpdate = s;
    if (s.status === "finished") {
      finished = true;
      return;
    }
    if (s.myTurn) {
      // Erste legale Karte spielen.
      const idx = s.legalActionMask.indexOf(1);
      if (idx < 0) {
        console.error("  myTurn=true aber keine legalen Züge?!");
        return;
      }
      const card = {
        suit: SUITS[Math.floor(idx / 9)]!,
        rank: RANKS[idx % 9]!,
      };
      humanMovesPlayed++;
      socket.emit("game:move", { gameId, card });
    }
  });

  socket.on("game:ended", () => {
    finished = true;
  });

  await new Promise<void>((res, rej) => {
    socket.once("connect", res);
    setTimeout(() => rej(new Error("WS connect timeout")), 5_000);
  });
  console.info(`  WS verbunden (${socket.id}), join...`);
  socket.emit("game:join", { gameId });

  // Warten bis das Spiel fertig ist.
  const timeoutAt = Date.now() + 30_000;
  while (!finished) {
    if (Date.now() > timeoutAt) throw new Error("Game-Loop-Timeout (>30s)");
    await sleep(50);
  }

  socket.disconnect();

  // 4) Auswerten
  const u = lastUpdate;
  if (!u) throw new Error("Kein game:state empfangen");
  console.info("");
  console.info("=== Resultat ===");
  console.info(`  status:              ${u.status}`);
  console.info(`  completed_tricks:    ${u.state.completed_tricks.length}`);
  console.info(`  trick_idx:           ${u.state.trick_idx}`);
  console.info(`  hand size (eigene):  ${u.hand.length}`);
  console.info(`  human-moves played:  ${humanMovesPlayed}`);
  if (u.finalScore) {
    const sum = u.finalScore.team_card_points.reduce((a, b) => a + b, 0);
    console.info(`  team_card_points:    [${u.finalScore.team_card_points.join(", ")}]`);
    console.info(`  matsch_team:         ${u.finalScore.matsch_team}`);
    console.info(`  trick_winners:       [${u.finalScore.trick_winners.join(", ")}]`);
    console.info(`  Punkte-Summe:        ${sum}`);
    const expected = 157;
    if (sum !== expected) {
      throw new Error(`Punktesumme ${sum} != ${expected} (152 + 5 Letzter-Stich-Bonus)`);
    }
  } else {
    throw new Error("Kein finalScore im letzten game:state — Game nicht fertig?");
  }
  if (u.state.completed_tricks.length !== 9) {
    throw new Error(`Erwartet 9 completed_tricks, bekommen ${u.state.completed_tricks.length}`);
  }
  if (u.hand.length !== 0) {
    throw new Error(`Hand hätte leer sein müssen, ist aber ${u.hand.length}`);
  }
  console.info("");
  console.info("=== OK ===");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err: unknown) => {
  console.error("[play-smoke] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
