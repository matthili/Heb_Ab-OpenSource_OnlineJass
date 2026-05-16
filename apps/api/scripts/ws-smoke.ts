#!/usr/bin/env tsx
/**
 * Manueller End-to-End-Smoke-Test des WS-Gateways.
 *
 * Lauf: gegen die laufende API + den Compose-Stack.
 *   pnpm --filter @jass/api exec tsx scripts/ws-smoke.ts
 *
 * Ablauf:
 *   1. HTTP sign-in als matthias_test → Cookie holen
 *   2. HTTP POST /api/games → Tisch eröffnen mit Sitz 0 = matthias, 1..3 = random-KI
 *   3. WS connect mit Cookie → "game:join" → erstes `game:state` empfangen
 *   4. "game:move" mit der ersten legalen Karte → neues `game:state` empfangen
 *
 * Erwartet eine fertige API auf http://localhost:3000 + Compose-Stack (PG/Redis).
 */
import { io, type Socket } from "socket.io-client";

const API_URL = process.env["API_URL"] ?? "http://localhost:3000";
const EMAIL = "matthias@jass.local";
const PASSWORD = "my-secret-passw0rd!";

async function main(): Promise<void> {
  console.info("--- 1) HTTP sign-in ---");
  const loginRes = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: API_URL },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`sign-in failed: ${loginRes.status}`);
  const setCookies = loginRes.headers.getSetCookie();
  if (setCookies.length === 0) throw new Error("Keine Set-Cookie-Header in sign-in-Response");
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  console.info("    cookie:", cookieHeader.slice(0, 60), "...");

  console.info("--- 2) POST /api/games ---");
  const createRes = await fetch(`${API_URL}/api/games`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: API_URL,
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      variant: { mode: "TRUMPF", trump_suit: "EICHEL" },
      starter: 0,
      coplayers: [{ aiSeatType: "random" }, { aiSeatType: "random" }, { aiSeatType: "random" }],
      rngSeed: 2026,
    }),
  });
  if (!createRes.ok) {
    throw new Error(`create-game failed: ${createRes.status} — ${await createRes.text()}`);
  }
  const { gameId } = (await createRes.json()) as { gameId: string };
  console.info("    gameId:", gameId);

  console.info("--- 3) WS connect + join ---");
  const socket: Socket = io(API_URL, {
    path: "/ws",
    transports: ["websocket"],
    extraHeaders: { Cookie: cookieHeader },
    auth: {},
    reconnection: false,
  });

  socket.on("game:error", (e: { message: string }) => {
    console.error("    [ERR]", e.message);
  });

  const firstState = waitForEvent<unknown>(socket, "game:state");
  await waitForEvent<void>(socket, "connect");
  console.info("    connected, sid:", socket.id);

  socket.emit("game:join", { gameId });
  const state1 = (await firstState) as {
    status: string;
    hand: { suit: string; rank: string }[];
    legalActionMask: number[];
    myTurn: boolean;
  };
  console.info("    join: status=", state1.status, "myTurn=", state1.myTurn);
  console.info("    hand size:", state1.hand.length, "first:", state1.hand[0]);

  console.info("--- 4) WS move: erste legale Karte spielen ---");
  // Erste legale Karte aus der Hand finden (Mask-Index → Karte)
  const firstLegalIdx = state1.legalActionMask.indexOf(1);
  if (firstLegalIdx < 0) throw new Error("Keine legalen Züge?");
  const suitOrder = ["EICHEL", "SCHELLE", "HERZ", "LAUB"] as const;
  const rankOrder = [
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
  const move = {
    suit: suitOrder[Math.floor(firstLegalIdx / 9)]!,
    rank: rankOrder[firstLegalIdx % 9]!,
  };
  console.info("    spielen:", move);

  // game:state-Events sammeln, bis ich wieder dran bin (oder Runde vorbei).
  const stateUpdates: Array<{
    hand: { suit: string; rank: string }[];
    myTurn: boolean;
    whoseTurnSeat: number;
    status: string;
  }> = [];
  let resolveMyTurn: (() => void) | null = null;
  const myTurnAgain = new Promise<void>((r) => {
    resolveMyTurn = r;
  });
  socket.on(
    "game:state",
    (s: {
      hand: { suit: string; rank: string }[];
      myTurn: boolean;
      whoseTurnSeat: number;
      status: string;
    }) => {
      stateUpdates.push(s);
      if (s.myTurn || s.status === "finished") resolveMyTurn?.();
    }
  );

  socket.emit("game:move", { gameId, card: move });
  await Promise.race([
    myTurnAgain,
    new Promise<void>((_, rej) =>
      setTimeout(() => rej(new Error("timeout waiting for own turn again")), 10_000)
    ),
  ]);

  const last = stateUpdates[stateUpdates.length - 1]!;
  console.info("    state-updates empfangen:", stateUpdates.length);
  console.info(
    "    final: status=",
    last.status,
    "hand size=",
    last.hand.length,
    "myTurn=",
    last.myTurn,
    "whoseTurnSeat=",
    last.whoseTurnSeat
  );

  socket.disconnect();
  console.info("--- OK ---");
}

function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolveP, rejectP) => {
    const t = setTimeout(() => {
      socket.off(event);
      rejectP(new Error(`Timeout waiting for '${event}'`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      resolveP(payload);
    });
  });
}

main().catch((err: unknown) => {
  console.error("[ws-smoke] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
