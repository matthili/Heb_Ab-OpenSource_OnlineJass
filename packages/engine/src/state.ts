/**
 * GameState-Reducer-Stub.
 *
 * Volle `applyMove(state, move) → newState`-Implementation kommt mit M4 (WS-Gateway
 * + Single-Table-Game-Loop), wenn der Server-autoritative Spielzustand persistiert
 * werden muss.
 *
 * Bis dahin re-exportiert dieses Modul nur den `GameState`-Typ, damit Konsumenten
 * `@jass/engine/state` schon importieren können (stabiler Public-API-Pfad).
 */

export type { GameState } from "./types.js";
