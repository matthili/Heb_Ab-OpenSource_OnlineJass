/**
 * Integration-Test: WS-Rate-Limit blockt Spam-Frames + disconnectet bei
 * wiederholten Verstößen.
 *
 * Wir schicken bewusst mehr `game:move`-Frames als das Limit erlaubt,
 * binden uns auf das `game:error`-Event und auf `disconnect`. Beides
 * muss kommen — sonst greift der Schutz nicht.
 *
 * Das hier ist ein „End-to-End"-Beweis, dass `SocketRateTracker` im
 * GameGateway via `socket.use()` tatsächlich Frames verwirft, bevor sie
 * einen Service-Call auslösen.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";

import { signUpAndIn, type SignedInUser } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

describe("WS-Rate-Limit", () => {
  let app: TestAppHandle;
  let user: SignedInUser;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
    user = await signUpAndIn(app, {
      email: "spammer@jass.local",
      password: "long-test-password-12345!",
      name: "spammer",
    });
  });

  afterAll(async () => {
    /* globalTeardown */
  });

  function connect(u: SignedInUser): Promise<Socket> {
    const socket = io(app.baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { Cookie: u.http.cookieHeader() },
      reconnection: false,
    });
    return new Promise((resolve, reject) => {
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", (e) => reject(new Error(`WS connect: ${e.message}`)));
      setTimeout(() => reject(new Error("WS connect timeout")), 5_000);
    });
  }

  /**
   * Wir benutzen `lobby:subscribe-table` für den Stress-Test, weil
   * dessen Handler einen Pure-Memory-Op macht (Socket in einen Room
   * joinen) — kein DB-Lookup, der bei „nonexistent" durchrauschen
   * würde und im Hintergrund unhandled rejections produzieren könnte.
   * Default-Limit für diese Event-Klasse: 20 in 10 s.
   */
  it("verwirft Frames über dem Per-Event-Limit + meldet game:error", async () => {
    const socket = await connect(user);
    const errors: string[] = [];
    socket.on("game:error", (payload: { message?: string }) => {
      if (payload?.message) errors.push(payload.message);
    });

    // 22 Frames: erste 20 unter Limit, 2 Verstöße — KEIN Disconnect
    // (Threshold 5).
    for (let i = 0; i < 22; i++) {
      socket.emit("lobby:subscribe-table", { tableId: `t-${i}` });
    }
    await new Promise((r) => setTimeout(r, 300));

    const rateLimitErrors = errors.filter((m) => m.includes("Rate-Limit"));
    expect(rateLimitErrors.length).toBeGreaterThanOrEqual(2);
    expect(socket.connected).toBe(true);

    socket.disconnect();
  });

  it("disconnectet bei wiederholten Verstößen + Audit-Eintrag", async () => {
    const socket = await connect(user);
    const disconnectPromise = new Promise<string>((resolve) => {
      socket.once("disconnect", (reason) => resolve(reason));
    });

    // 6 Verstöße erzwingen: Limit ist 20 in 10 s, also
    // 20 + 6 = 26 Frames in einer Burst.
    for (let i = 0; i < 26; i++) {
      socket.emit("lobby:subscribe-table", { tableId: `t-${i}` });
    }

    const reason = await Promise.race([
      disconnectPromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("kein disconnect erhalten")), 3000)
      ),
    ]);
    expect(reason).toBeTruthy();

    const audit = await app.prisma.auditLog.findFirst({
      where: { action: "security.ws.disconnect.rate_limit" },
    });
    expect(audit).not.toBeNull();
  });
});
