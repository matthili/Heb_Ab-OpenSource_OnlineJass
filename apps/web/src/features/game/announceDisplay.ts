/**
 * Gemeinsame Anzeige-Logik für die Ansage (Trumpf/Gumpf/Oben/Unten/Slalom):
 * liefert Icon-Pfad bzw. Glyph + Titel/Untertitel-Texte. Genutzt vom
 * Ansage-Overlay (transient, 3 s) und vom Modus-Wasserzeichen (dauerhaft),
 * sowohl im Kreuz-/Solo-Spielfeld als auch im Bodensee-Tisch.
 *
 * **Wichtig**: Bei Slalom wechselt die effektive Variante pro Stich — diese
 * Funktion bekommt deshalb die STABILE Ansage übergeben (Startmodus +
 * `slalom`-Flag), nicht die pro-Stich-effektive Variante.
 *
 * Die Suit-Icons liegen unter `public/cards/suits/` (von `assets/cards/suits`
 * gespiegelt): `{suit}.png`, `{suit}_gumpf.png`, `slalom.png`.
 */
import type { PlayMode, Suit } from "@jass/engine";
import type { TFunction } from "i18next";

export interface AnnounceModeInfo {
  mode: PlayMode;
  /** `| undefined` explizit (exactOptionalPropertyTypes) — Aufrufer reichen
   *  `variant.trump_suit` direkt durch, das bei Oben/Unten undefined ist. */
  trumpSuit?: Suit | undefined;
  slalom: boolean;
}

export interface AnnounceDisplay {
  /** Pfad zum Suit-Icon, oder null wenn kein passendes Icon (Oben/Unten). */
  iconSrc: string | null;
  /** Fallback-Glyph, wenn es kein Icon gibt (Oben ↑ / Unten ↓). */
  glyph: string | null;
  /** Hauptzeile, z.B. „Eichel ist Trumpf". */
  title: string;
  /** Kleinere Erläuterung, z.B. die Gumpf-/Slalom-Regel; null = keine. */
  subtitle: string | null;
}

const SUIT_FILE: Record<Suit, string> = {
  EICHEL: "eichel",
  SCHELLE: "schelle",
  HERZ: "herz",
  LAUB: "laub",
};

export function announceDisplay(t: TFunction, info: AnnounceModeInfo): AnnounceDisplay {
  const { mode, trumpSuit, slalom } = info;

  if (slalom) {
    return {
      iconSrc: "/cards/suits/slalom.png",
      glyph: null,
      title: t("game.announceOverlay.slalom"),
      subtitle: t("game.announceOverlay.slalomSub", {
        start: t(`game.announce.mode.${mode}`),
      }),
    };
  }

  if (mode === "TRUMPF" && trumpSuit) {
    return {
      iconSrc: `/cards/suits/${SUIT_FILE[trumpSuit]}.png`,
      glyph: null,
      title: t("game.announceOverlay.trumpf", { suit: t(`game.announce.suit.${trumpSuit}`) }),
      subtitle: null,
    };
  }

  if (mode === "GUMPF" && trumpSuit) {
    return {
      iconSrc: `/cards/suits/${SUIT_FILE[trumpSuit]}_gumpf.png`,
      glyph: null,
      title: t("game.announceOverlay.gumpf", { suit: t(`game.announce.suit.${trumpSuit}`) }),
      subtitle: t("game.announceOverlay.gumpfSub", {
        suit: t(`game.announce.suit.${trumpSuit}`),
      }),
    };
  }

  // OBEN / UNTEN — kein Trumpf, kein Suit-Icon → Pfeil-Glyph + Modus-Label.
  return {
    iconSrc: null,
    glyph: mode === "OBEN" ? "↑" : "↓",
    title: t(`game.announce.mode.${mode}`),
    subtitle: null,
  };
}
