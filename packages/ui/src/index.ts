/**
 * @jass/ui — geteilte React-UI-Komponenten.
 *
 * Komponenten:
 *   - Card    (M7-A): einzelne Spielkarte
 *   - Hand    (M7-E): eigene Karten mit Legal-Mask + Click-Handler
 *   - Trick   (M7-E): 4-Slot-Stichvisualisierung mit Winner-Highlight
 *   - Scoreboard (M7-E): Punkte + Trumpf-Anzeige
 *
 * ChatBubble folgt mit M8.
 */
export { Card, type CardProps } from "./Card/Card.js";
export { Hand, type HandProps } from "./Hand/Hand.js";
export { Trick, type TrickProps } from "./Trick/Trick.js";
export { Scoreboard, type ScoreboardProps } from "./Scoreboard/Scoreboard.js";

export const UI_PACKAGE_VERSION = "0.0.2-m7e";
