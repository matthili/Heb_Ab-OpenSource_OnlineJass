/**
 * @jass/engine — Public-API.
 *
 * Stabile Importe für API, Inference-Microservice und Frontend-Komponenten.
 * Goldstandard: jass_engine/ + training/encoder.py im Schwester-Repo
 * jass-neuronales-netz.
 */

export * from "./types.js";
export { cardIndex, cardsEqual, indexToCard, isWeli } from "./cards.js";
export { cardStrength, cardValue, legalMoves, trickPoints, trickWinner } from "./rules.js";
export { encodeState, legalActionMask } from "./encoder.js";

export const ENGINE_PACKAGE_VERSION = "0.1.0";
