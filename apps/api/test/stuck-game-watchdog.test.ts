/**
 * Unit-Test der reinen Auswahl-Logik des Spiel-Watchdogs (`pickStuckGameIds`).
 * DB-frei: prüft nur, welche laufenden Partien als „hängend" gelten.
 */
import { describe, expect, it } from "vitest";

import {
  pickStuckGameIds,
  type GameProgress,
} from "../src/modules/game/stuck-game-watchdog.service.js";

const cutoff = new Date("2026-06-19T12:00:00Z");
const before = new Date("2026-06-19T11:55:00Z"); // vor dem cutoff → hängt
const after = new Date("2026-06-19T12:05:00Z"); // nach dem cutoff → frisch

const game = (id: string, p: Partial<GameProgress>): GameProgress => ({
  id,
  variant: "KREUZ_4P",
  startedAt: before,
  lastMoveAt: null,
  ...p,
});

describe("pickStuckGameIds", () => {
  it("nimmt Partien, deren jüngster Zug vor dem cutoff liegt", () => {
    const r = pickStuckGameIds(
      [game("stuck", { lastMoveAt: before }), game("fresh", { lastMoveAt: after })],
      cutoff
    );
    expect(r).toEqual(["stuck"]);
  });

  it("ohne Züge zählt der Spielstart", () => {
    const r = pickStuckGameIds(
      [
        game("old-nomoves", { startedAt: before, lastMoveAt: null }),
        game("new-nomoves", { startedAt: after, lastMoveAt: null }),
      ],
      cutoff
    );
    expect(r).toEqual(["old-nomoves"]);
  });

  it("jüngster Zug schlägt alten Spielstart (lange Partie, gerade noch aktiv)", () => {
    const r = pickStuckGameIds(
      [game("long-active", { startedAt: before, lastMoveAt: after })],
      cutoff
    );
    expect(r).toEqual([]);
  });

  it("leere Liste → leer", () => {
    expect(pickStuckGameIds([], cutoff)).toEqual([]);
  });
});
