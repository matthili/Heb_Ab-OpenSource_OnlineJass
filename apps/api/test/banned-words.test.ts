/**
 * Unit-Tests für `maskMessage` (Chat-Wortfilter).
 *
 * Reine Funktion ohne DB — testet die Substring-Match-Logik:
 *   - case-insensitive
 *   - Ersatz durch genau `***` (markdown-neutral)
 *   - mehrere Treffer + Mehrfach-Vorkommen
 *   - Regex-Sonderzeichen im Banned-Word werden escaped
 */
import { describe, expect, it } from "vitest";

import { maskMessage } from "../src/modules/chat/banned-words.service.js";

describe("maskMessage", () => {
  it("ersetzt einen Treffer durch ***", () => {
    const r = maskMessage("Du bist scheiß doof", ["scheiß"]);
    expect(r.clean).toBe("Du bist *** doof");
    expect(r.matched).toEqual(["scheiß"]);
  });

  it("ist case-insensitive", () => {
    const r = maskMessage("Was SCHEIßE!", ["scheiß"]);
    // Substring-Match → "SCHEIß" wird ersetzt, das "E!" bleibt.
    expect(r.clean).toBe("Was ***E!");
    expect(r.matched).toEqual(["scheiß"]);
  });

  it("ersetzt mehrere verschiedene Wörter — jedes maskiert + im matched-Array", () => {
    const r = maskMessage("Du fuck nochmal, ist scheiß!", ["fuck", "scheiß"]);
    expect(r.clean).toBe("Du *** nochmal, ist ***!");
    expect(r.matched.sort()).toEqual(["fuck", "scheiß"]);
  });

  it("ersetzt mehrere Vorkommen desselben Worts", () => {
    const r = maskMessage("fuck fuck fuck", ["fuck"]);
    expect(r.clean).toBe("*** *** ***");
    expect(r.matched).toEqual(["fuck"]);
  });

  it("liefert Body unverändert zurück, wenn nichts matcht", () => {
    const r = maskMessage("Alles ganz lieb hier", ["fuck", "scheiß"]);
    expect(r.clean).toBe("Alles ganz lieb hier");
    expect(r.matched).toEqual([]);
  });

  it("leere Liste → Body unverändert", () => {
    const r = maskMessage("Da steht ein böses Wort", []);
    expect(r.clean).toBe("Da steht ein böses Wort");
    expect(r.matched).toEqual([]);
  });

  it("Regex-Sonderzeichen im Banned-Word werden escaped (kein Pattern-Bug)", () => {
    // Banned word ".+" darf nicht als Regex „1+ beliebige Zeichen" interpretiert
    // werden, sonst würde es jede Nachricht komplett maskieren.
    const r = maskMessage("Hallo, gib mir 2+3 Sterne", [".+"]);
    expect(r.clean).toBe("Hallo, gib mir 2+3 Sterne");
    expect(r.matched).toEqual([]);
  });

  it("leere Wörter in der Liste werden übersprungen", () => {
    const r = maskMessage("ein normaler Satz", ["", "  "]);
    // "  " ist nicht leer (whitespace), würde aber matchen — der Service
    // normalisiert beim Speichern via trim(); hier prüfen wir nur die
    // reine Funktion. Wir testen explizit den leeren String.
    const r2 = maskMessage("ein normaler Satz", [""]);
    expect(r2.clean).toBe("ein normaler Satz");
    expect(r2.matched).toEqual([]);
    // Doku-Test: die Funktion ist roh, der Service ist für sauberen Input
    // verantwortlich.
    void r;
  });
});
