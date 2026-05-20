/**
 * @jass/engine — Public-API.
 *
 * Stabile Importe für API, Inference-Microservice und Frontend-Komponenten.
 * Goldstandard: jass_engine/ + training/encoder.py im Schwester-Repo
 * jass-neuronales-netz.
 */

export * from "./types.js";
export { cardIndex, cardsEqual, indexToCard, isWeli } from "./cards.js";
export {
  cardStrength,
  cardValue,
  hasTrumpSuit,
  legalMoves,
  trickPoints,
  trickWinner,
} from "./rules.js";
export { encodeState, legalActionMask } from "./encoder.js";
export {
  type Move,
  type RandomFn,
  type RoundScore,
  type RoundState,
  DEFAULT_TEAMS,
  SOLO_TEAMS,
  InvalidMoveError,
  announceStoeck,
  applyMove,
  clickWeisenButton,
  dealCards,
  finalRoundScore,
  freshDeck,
  handOf,
  isRoundDone,
  newRound,
  shuffleDeck,
  submitWeisen,
  viewAsPlayer,
  weisenSeatStatus,
  weisenWindowOpen,
  whoseTurn,
  type WeisenSeatStatus,
} from "./state.js";

export {
  aggregateWeisen,
  compareDeclarations,
  findBestWeisenForHand,
  validateDeclaration,
  type InvalidWeisDeclaration,
  type InvalidWeisReason,
  type WeisDeclaration,
  type WeisKind,
  type WeisenAggregateInput,
  type WeisenAggregateResult,
} from "./weisen.js";

export const ENGINE_PACKAGE_VERSION = "0.2.0";
