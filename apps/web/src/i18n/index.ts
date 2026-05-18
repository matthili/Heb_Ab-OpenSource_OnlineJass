/**
 * i18n-Initialisierung für die Spiel-SPA.
 *
 * **Sprachen**: `de` (primär, Inhalte im Vorarlberger Dialekt — der
 * Locale-Code ist BCP-47-konform „de"; Vorarlbergerisch ist eine
 * Dialekt-Variante davon, kein eigener Locale), `en` (sekundär).
 * Dialekt-Begriffe (WELI, Bauer/Ober, …) bleiben in beiden Sprachen
 * unverändert, um die Vorarlberger Eigenheiten zu erhalten.
 *
 * **Detection**: `i18next-browser-languagedetector` liest localStorage
 * (`i18nextLng`-Key) — der manuelle Sprach-Wechsel aus der UI persistiert
 * dort. Fallback ist `de`.
 *
 * **Namespace**: nur `common`. Wenn die App größer wird, splitten wir
 * (z.B. nach Feature: `lobby.json`, `game.json`).
 */
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import de from "./de/common.json";
import en from "./en/common.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { common: de },
      en: { common: en },
    },
    fallbackLng: "de",
    supportedLngs: ["de", "en"],
    ns: ["common"],
    defaultNS: "common",
    interpolation: {
      // React escaped sowieso schon — Doppel-Escaping vermeiden.
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      // Browser-Sprache: alle deutschen Varianten (de-DE, de-AT, de-CH, …)
      // auf `de` mappen, alles andere durchreichen.
      convertDetectedLanguage: (lng) => {
        if (lng.startsWith("de")) return "de";
        return lng;
      },
    },
  });

export default i18n;
