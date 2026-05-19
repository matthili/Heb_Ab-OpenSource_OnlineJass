/**
 * Tests für SocketRateTracker. Deterministisch dank explizitem `now`-Parameter
 * — keine Timer/sleeps nötig.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_WS_RATE_LIMIT,
  SocketRateTracker,
  type WsRateLimitConfig,
} from "../src/common/ws-rate-limit.js";

describe("SocketRateTracker", () => {
  it("erlaubt Events innerhalb des Limits", () => {
    const t = new SocketRateTracker();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      const r = t.check("game:move", t0 + i);
      expect(r.allow).toBe(true);
    }
  });

  it("verwirft das 11. Event innerhalb des 10-Event-Fensters", () => {
    const t = new SocketRateTracker();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) t.check("game:move", t0 + i);
    const r = t.check("game:move", t0 + 11);
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.disconnect).toBe(false); // erst 1 Verstoß
  });

  it("erlaubt Events wieder, sobald das Fenster abgelaufen ist", () => {
    const t = new SocketRateTracker();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) t.check("game:move", t0 + i);
    // 10s+1ms später ist das Fenster leer.
    const r = t.check("game:move", t0 + 10_001);
    expect(r.allow).toBe(true);
  });

  it("rechnet Limits getrennt pro Event-Typ", () => {
    const t = new SocketRateTracker();
    const t0 = 1_000_000;
    // 10x game:move ausschöpfen
    for (let i = 0; i < 10; i++) t.check("game:move", t0 + i);
    // game:announce hat eigenes Limit (= 10), also noch frei
    expect(t.check("game:announce", t0 + 11).allow).toBe(true);
  });

  it("disconnect-Flag wird gesetzt nach `disconnectAfterViolations` Verstößen", () => {
    const t = new SocketRateTracker();
    const t0 = 1_000_000;
    // Limit ausschöpfen
    for (let i = 0; i < 10; i++) t.check("game:move", t0 + i);
    // Erste 4 Verstöße: nicht-disconnect
    for (let i = 1; i <= 4; i++) {
      const r = t.check("game:move", t0 + 10 + i);
      expect(r.allow).toBe(false);
      if (!r.allow) expect(r.disconnect).toBe(false);
    }
    // 5. Verstoß → disconnect
    const final = t.check("game:move", t0 + 20);
    expect(final.allow).toBe(false);
    if (!final.allow) expect(final.disconnect).toBe(true);
  });

  it("Verstöße verfallen nach `violationWindowMs` (1 min Default)", () => {
    const t = new SocketRateTracker();
    const t0 = 1_000_000;
    // 5 Verstöße direkt hintereinander erzeugen
    for (let i = 0; i < 10; i++) t.check("game:move", t0 + i);
    for (let i = 1; i <= 4; i++) t.check("game:move", t0 + 10 + i);
    // 61 s später: alte Verstöße raus aus dem Verstoß-Fenster.
    const later = t0 + 61_000;
    // Frisches Limit (Events-Fenster ist 10 s, also längst leer).
    // Wir provozieren einen neuen Verstoß durch Limit-Ausschöpfung.
    for (let i = 0; i < 10; i++) t.check("game:move", later + i);
    const r = t.check("game:move", later + 11);
    expect(r.allow).toBe(false);
    // Nur 1 frischer Verstoß → kein Disconnect.
    if (!r.allow) expect(r.disconnect).toBe(false);
  });

  it("Default-Limit greift für nicht-konfigurierte Events", () => {
    // Custom-Config mit nur einem Eintrag — alle anderen fallen auf default zurück.
    const cfg: WsRateLimitConfig = {
      ...DEFAULT_WS_RATE_LIMIT,
      perEvent: {
        "game:move": { windowMs: 10_000, max: 10 },
      },
      default: { windowMs: 1_000, max: 3 },
    };
    const t = new SocketRateTracker(cfg);
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(t.check("unknown-event", t0 + i).allow).toBe(true);
    }
    expect(t.check("unknown-event", t0 + 3).allow).toBe(false);
  });
});
