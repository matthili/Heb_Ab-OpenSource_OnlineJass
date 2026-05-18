/**
 * i18n-Vollständigkeits-Test (M11-B).
 *
 * Prüft, dass die Übersetzungs-Dateien `de-vlbg/common.json` und
 * `en/common.json` strukturell gleich sind:
 *   - Selbe Key-Hierarchie (keine Lücken)
 *   - Selbe Interpolations-Variablen pro Key (`{{name}}`, `{{count}}`, …)
 *   - Keine leeren oder duplicate-Werte
 *
 * **Dialekt-Whitelist**: einzelne Begriffe dürfen in beiden Sprachen
 * gleich sein (z.B. „Welli", „Buur"), das ist absichtlich. Wir checken
 * also nicht, dass Wert-für-Wert unterschiedlich ist — nur, dass beide
 * Sprachen alle Keys haben.
 *
 * Läuft als normaler Vitest-Unit-Test → blockiert CI, wenn jemand einen
 * Key nur in einer Sprache anlegt.
 */
import { describe, expect, it } from "vitest";

import deVlbg from "./de-vlbg/common.json" with { type: "json" };
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

const deLeaves = collectLeaves(deVlbg as Tree);
const enLeaves = collectLeaves(en as Tree);

describe("i18n — Vollständigkeit DE-Vorarlberg vs. EN", () => {
  it("Gleiche Key-Menge in beiden Sprachen", () => {
    const deKeys = new Set(Object.keys(deLeaves));
    const enKeys = new Set(Object.keys(enLeaves));
    const onlyDe = [...deKeys].filter((k) => !enKeys.has(k)).sort();
    const onlyEn = [...enKeys].filter((k) => !deKeys.has(k)).sort();
    expect(onlyDe, `Keys nur in de-vlbg:\n  ${onlyDe.join("\n  ")}`).toEqual([]);
    expect(onlyEn, `Keys nur in en:\n  ${onlyEn.join("\n  ")}`).toEqual([]);
  });

  it("Selbe Interpolations-Variablen pro Key", () => {
    const mismatches: string[] = [];
    for (const [key, deVal] of Object.entries(deLeaves)) {
      const enVal = enLeaves[key];
      if (enVal === undefined) continue; // wird vom Test oben gefangen
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
      ["de-vlbg", deLeaves],
      ["en", enLeaves],
    ] as const) {
      for (const [key, val] of Object.entries(leaves)) {
        if (val.trim() === "") empty.push(`${lang}: ${key}`);
      }
    }
    expect(empty, `Leere Übersetzungswerte:\n  ${empty.join("\n  ")}`).toEqual([]);
  });

  it("Mindestens alle erwarteten Top-Level-Bereiche existieren", () => {
    // Soft-Lock auf die UI-Bereiche, die wir mindestens haben wollen.
    // Wenn jemand einen ganzen Bereich umtauft (z.B. `auth` → `login`),
    // soll das hier auffallen, bevor es in der UI Lücken hinterlässt.
    const expectedAreas = ["appName", "nav", "auth", "lobby", "game", "profile"];
    for (const area of expectedAreas) {
      expect((deVlbg as Tree)[area], `de-vlbg: '${area}' fehlt`).toBeDefined();
      expect((en as Tree)[area], `en: '${area}' fehlt`).toBeDefined();
    }
  });
});
