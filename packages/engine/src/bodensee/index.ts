/**
 * **Bodensee-Jass — Public API des Engine-Submoduls.**
 *
 * Bündelt Typen, Regeln, Round-State und Encoder der 2-Spieler-Variante.
 * Wird vom Haupt-`index.ts` re-exportiert.
 */
export {
  BODENSEE_NUM_PLAYERS,
  BODENSEE_HAND_SIZE,
  BODENSEE_TABLE_STACKS,
  BODENSEE_TRICKS_PER_ROUND,
  BODENSEE_DEFAULT_TARGET,
  type TableStack,
  type BodenseeRoundState,
  type BodenseeGameState,
  type BodenseeEncoderInput,
  type BodenseeMove,
  type BodenseeRoundScore,
} from "./types.js";

export { legalMovesBodensee, cardSource, visibleTableCards, hiddenTableCount } from "./rules.js";

export { bodenseeBergpreisWinnerFromState } from "./bergpreis.js";

export {
  InvalidBodenseeMoveError,
  dealBodensee,
  findWeliHolderBodensee,
  bodenseeEffectiveVariant,
  newBodenseeRound,
  whoseTurnBodensee,
  isBodenseeRoundDone,
  applyBodenseeMove,
  finalBodenseeScore,
  bodenseeHandOf,
  bodenseeTableOf,
  bodenseeViewAsPlayer,
  bodenseeEncoderInput,
} from "./state.js";

export {
  BODENSEE_STATE_DIM,
  BODENSEE_ACTION_DIM,
  BODENSEE_ENCODING_VERSION,
  encodeBodenseeState,
  legalActionMaskBodensee,
} from "./encoder.js";
