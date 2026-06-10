/**
 * @jass/ui — geteilte React-UI-Komponenten.
 *
 * Komponenten:
 *   - Card    (M7-A): einzelne Spielkarte
 *   - Hand    (M7-E): eigene Karten mit Legal-Mask + Click-Handler
 *   - Trick   (M7-E): 4-Slot-Stichvisualisierung mit Winner-Highlight
 *   - Scoreboard (M7-E): Punkte + Trumpf-Anzeige
 *
 * Die Chat-Komponenten (ChatBubble/ChatPanel) leben in `apps/web`, nicht hier.
 */
export { Card, type CardProps } from "./Card/Card.js";
export { Hand, type HandProps } from "./Hand/Hand.js";
export { Trick, type TrickProps } from "./Trick/Trick.js";
export {
  Scoreboard,
  useScorePop,
  type ScoreboardProps,
  type SoloScoreEntryData,
} from "./Scoreboard/Scoreboard.js";
export { useAnimatedNumber } from "./Scoreboard/useAnimatedNumber.js";

export const UI_PACKAGE_VERSION = "0.0.2-m7e";
