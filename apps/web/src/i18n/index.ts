/**
 * i18n-Initialisierung für die Spiel-SPA.
 *
 * **Sprachen**: `de-vlbg` (primär, Plan-Doc §1), `en` (sekundär).
 * Dialekt-Begriffe (Welli, Bauer/Ober, …) bleiben in beiden Sprachen
 * unverändert, um die Vorarlberger Eigenheiten zu erhalten.
 *
 * **Detection**: `i18next-browser-languagedetector` liest localStorage
 * (`i18nextLng`-Key) — der manuelle Sprach-Wechsel aus der UI persistiert
 * dort. Fallback ist `de-vlbg`.
 *
 * **Namespace**: nur `common`. Wenn die App größer wird, splitten wir
 * (z.B. nach Feature: `lobby.json`, `game.json`).
 */
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import deVlbg from "./de-vlbg/common.json";
import en from "./en/common.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "de-vlbg": { common: deVlbg },
      en: { common: en },
    },
    fallbackLng: "de-vlbg",
    supportedLngs: ["de-vlbg", "en"],
    ns: ["common"],
    defaultNS: "common",
    interpolation: {
      // React escaped sowieso schon — Doppel-Escaping vermeiden.
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      // Browser-Sprache → mappe auf de-vlbg, falls deutsch.
      convertDetectedLanguage: (lng) => {
        if (lng.startsWith("de")) return "de-vlbg";
        return lng;
      },
    },
  });

export default i18n;
