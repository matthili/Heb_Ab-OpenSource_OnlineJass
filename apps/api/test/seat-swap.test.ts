/**
 * Unit-Test für den `SeatSwapService` — den Zustandsautomaten des
 * Sitzplatz-Tauschs + Start-Countdown. Reiner Logik-Test mit gemockten
 * Abhängigkeiten (LobbyService/LobbyGateway) und Fake-Timern: kein Docker, kein
 * DB. Deckt Annahme, Ablehnung, „nicht mehr fragen", Cooldown, beide Timeouts
 * und den Start-Countdown ab.
 */
import { ForbiddenException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LobbyGateway } from "../src/modules/lobby/lobby.gateway.js";
import { SeatSwapService, type SeatSwapHost } from "../src/modules/lobby/seat-swap.service.js";

const T = "table1";

function makeService() {
  const gateway = { pushToUser: vi.fn() };
  const lobby = {
    pushTableState: vi.fn().mockResolvedValue(undefined),
    afterSwapResolved: vi.fn().mockResolvedValue(undefined),
    applyAcceptedSwap: vi.fn().mockResolvedValue(undefined),
    fireStartCountdown: vi.fn().mockResolvedValue(undefined),
  };
  const svc = new SeatSwapService(gateway as unknown as LobbyGateway);
  svc.bindHost(lobby as unknown as SeatSwapHost);
  return { svc, gateway, lobby };
}

describe("SeatSwapService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("Annahme: request → pick → accept tauscht + meldet beiden Seiten", () => {
    const { svc, gateway, lobby } = makeService();
    svc.requestSwap(T, "req", 0);
    expect(svc.isBusy(T)).toBe(true);
    expect(svc.snapshot(T)?.stage).toBe("selecting");

    svc.pickTarget(T, "req", 1, "tgt");
    expect(svc.snapshot(T)?.stage).toBe("awaiting-response");
    expect(gateway.pushToUser).toHaveBeenCalledWith(
      "tgt",
      "lobby:seat-swap-prompt",
      expect.objectContaining({ tableId: T, requesterId: "req", targetSeat: 1 })
    );

    svc.respondSwap(T, "tgt", "accept");
    expect(lobby.applyAcceptedSwap).toHaveBeenCalledWith(T, 0, 1, "req", "tgt");
    expect(gateway.pushToUser).toHaveBeenCalledWith(
      "req",
      "lobby:seat-swap-result",
      expect.objectContaining({ accepted: true })
    );
    expect(svc.isBusy(T)).toBe(false);
  });

  it("nur ein Tausch gleichzeitig pro Tisch", () => {
    const { svc } = makeService();
    svc.requestSwap(T, "req", 0);
    expect(() => svc.requestSwap(T, "req2", 2)).toThrow(ForbiddenException);
  });

  it("Ablehnung setzt Cooldown — sofortiger neuer Wunsch wird abgelehnt, nach 15 s erlaubt", () => {
    const { svc } = makeService();
    svc.requestSwap(T, "req", 0);
    svc.pickTarget(T, "req", 1, "tgt");
    svc.respondSwap(T, "tgt", "decline");
    expect(svc.isBusy(T)).toBe(false);
    // Cooldown aktiv:
    expect(() => svc.requestSwap(T, "req", 0)).toThrow(ForbiddenException);
    // Nach 15 s frei:
    vi.advanceTimersByTime(15_000);
    expect(() => svc.requestSwap(T, "req", 0)).not.toThrow();
  });

  it("'nicht mehr fragen' sperrt erneutes Anwählen desselben Ziels", () => {
    const { svc } = makeService();
    svc.requestSwap(T, "req", 0);
    svc.pickTarget(T, "req", 1, "tgt");
    svc.respondSwap(T, "tgt", "decline-forever");
    // Cooldown abwarten, dann erneut anfragen:
    vi.advanceTimersByTime(15_000);
    svc.requestSwap(T, "req", 0);
    expect(() => svc.pickTarget(T, "req", 1, "tgt")).toThrow(ForbiddenException);
  });

  it("Auswahl-Timeout (30 s) räumt auf, OHNE Cooldown", () => {
    const { svc, lobby } = makeService();
    svc.requestSwap(T, "req", 0);
    vi.advanceTimersByTime(30_000);
    expect(svc.isBusy(T)).toBe(false);
    expect(lobby.afterSwapResolved).toHaveBeenCalledWith(T);
    // Kein Cooldown beim reinen Auswahl-Timeout → sofort wieder erlaubt:
    expect(() => svc.requestSwap(T, "req", 0)).not.toThrow();
  });

  it("Antwort-Timeout (15 s) lehnt automatisch ab und setzt Cooldown", () => {
    const { svc, gateway, lobby } = makeService();
    svc.requestSwap(T, "req", 0);
    svc.pickTarget(T, "req", 1, "tgt");
    vi.advanceTimersByTime(15_000);
    expect(svc.isBusy(T)).toBe(false);
    expect(lobby.afterSwapResolved).toHaveBeenCalledWith(T);
    expect(gateway.pushToUser).toHaveBeenCalledWith(
      "req",
      "lobby:seat-swap-result",
      expect.objectContaining({ accepted: false, timedOut: true })
    );
    // Wunsch hat das Ziel erreicht → Cooldown:
    expect(() => svc.requestSwap(T, "req", 0)).toThrow(ForbiddenException);
  });

  it("Abbruch in der Auswahl-Phase räumt auf, OHNE Cooldown", () => {
    const { svc, lobby } = makeService();
    svc.requestSwap(T, "req", 0);
    svc.cancelSwap(T, "req");
    expect(svc.isBusy(T)).toBe(false);
    expect(lobby.afterSwapResolved).toHaveBeenCalledWith(T);
    expect(() => svc.requestSwap(T, "req", 0)).not.toThrow();
  });

  it("Start-Countdown feuert nach 8 s den Spielstart", () => {
    const { svc, lobby } = makeService();
    svc.armStartCountdown(T);
    expect(svc.startCountdownSnapshot(T)).not.toBeNull();
    vi.advanceTimersByTime(8_000);
    expect(lobby.fireStartCountdown).toHaveBeenCalledWith(T);
    expect(svc.startCountdownSnapshot(T)).toBeNull();
  });

  it("Start-Countdown wird während eines laufenden Tauschs nicht armiert", () => {
    const { svc } = makeService();
    svc.requestSwap(T, "req", 0);
    svc.armStartCountdown(T);
    expect(svc.startCountdownSnapshot(T)).toBeNull();
  });
});
