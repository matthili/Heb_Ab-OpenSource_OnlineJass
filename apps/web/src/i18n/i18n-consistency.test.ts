/**
 * i18n-Vollständigkeits-Test (M11-B).
 *
 * Prüft, dass die Übersetzungs-Dateien `de/common.json` und `en/common.json`
 * strukturell gleich sind:
 *   - Selbe Key-Hierarchie (keine Lücken)
 *   - Selbe Interpolations-Variablen pro Key (`{{name}}`, `{{count}}`, …)
 *   - Keine leeren Werte
 *
 * **Dialekt-Whitelist**: Inhalte dürfen in beiden Sprachen gleich sein
 * (z.B. „WELI", „Buur"). Wir prüfen nur Struktur, nicht Wert-Diversität.
 *
 * Läuft als normaler Vitest-Unit-Test → blockiert CI, wenn jemand einen
 * Key nur in einer Sprache anlegt.
 */
import { describe, expect, it } from "vitest";

import de from "./de/common.json" with { type: "json" };
import en from "./en/common.json" with { type: "json" };

type Tree = { [k: string]: string | Tree };

/** Sammelt alle Leaf-Pfade einer verschachtelten Übersetzungs-Struktur. */
function collectLeaves(t: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out[path] = v;
    } else {
      Object.assign(out, collectLeaves(v as Tree, path));
    }
  }
  return out;
}

/** Extrahiert alle `{{var}}`-Platzhalter aus einem Übersetzungswert. */
function extractVars(value: string): Set<string> {
  const vars = new Set<string>();
  const re = /\{\{\s*([\w-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m[1]) vars.add(m[1]);
  }
  return vars;
}

const deLeaves = collectLeaves(de as Tree);
const enLeaves = collectLeaves(en as Tree);

describe("i18n — Vollständigkeit DE vs. EN", () => {
  it("Keine Punkt-Zeichen in Key-Namen", () => {
    // i18next interpretiert `.` als Pfad-Separator: ein Key namens
    // `language.de-vlbg` wird gelesen als language → de → vlbg und löst
    // sich nicht auf. Dieser Test fängt das ab, bevor die UI rohe
    // Translation-Keys zeigt.
    const offenders: string[] = [];
    walk(de as Tree, "", offenders, "de");
    walk(en as Tree, "", offenders, "en");
    expect(
      offenders,
      `Keys mit '.' im Namen (werden von i18next als Pfad fehlinterpretiert):\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  it("Gleiche Key-Menge in beiden Sprachen", () => {
    const deKeys = new Set(Object.keys(deLeaves));
    const enKeys = new Set(Object.keys(enLeaves));
    const onlyDe = [...deKeys].filter((k) => !enKeys.has(k)).sort();
    const onlyEn = [...enKeys].filter((k) => !deKeys.has(k)).sort();
    expect(onlyDe, `Keys nur in de:\n  ${onlyDe.join("\n  ")}`).toEqual([]);
    expect(onlyEn, `Keys nur in en:\n  ${onlyEn.join("\n  ")}`).toEqual([]);
  });

  it("Selbe Interpolations-Variablen pro Key", () => {
    const mismatches: string[] = [];
    for (const [key, deVal] of Object.entries(deLeaves)) {
      const enVal = enLeaves[key];
      if (enVal === undefined) continue;
      const deVars = [...extractVars(deVal)].sort();
      const enVars = [...extractVars(enVal)].sort();
      if (deVars.join(",") !== enVars.join(",")) {
        mismatches.push(`${key}: de=[${deVars.join(",")}] en=[${enVars.join(",")}]`);
      }
    }
    expect(mismatches, `Variable-Drift:\n  ${mismatches.join("\n  ")}`).toEqual([]);
  });

  it("Keine leeren Werte", () => {
    const empty: string[] = [];
    for (const [lang, leaves] of [
      ["de", deLeaves],
      ["en", enLeaves],
    ] as const) {
      for (const [key, val] of Object.entries(leaves)) {
        if (val.trim() === "") empty.push(`${lang}: ${key}`);
      }
    }
    expect(empty, `Leere Übersetzungswerte:\n  ${empty.join("\n  ")}`).toEqual([]);
  });

  it("Mindestens alle erwarteten Top-Level-Bereiche existieren", () => {
    const expectedAreas = ["appName", "nav", "auth", "lobby", "game", "profile"];
    for (const area of expectedAreas) {
      expect((de as Tree)[area], `de: '${area}' fehlt`).toBeDefined();
      expect((en as Tree)[area], `en: '${area}' fehlt`).toBeDefined();
    }
  });
});

/** Rekursiv durchgeht das Tree und sammelt Keys, die einen `.` enthalten. */
function walk(t: Tree, prefix: string, offenders: string[], lang: string): void {
  for (const [k, v] of Object.entries(t)) {
    if (k.includes(".")) {
      offenders.push(`${lang}: ${prefix ? `${prefix}.` : ""}<${k}>`);
    }
    if (typeof v === "object") {
      walk(v as Tree, prefix ? `${prefix}.${k}` : k, offenders, lang);
    }
  }
}
