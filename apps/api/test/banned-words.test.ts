/**
 * Unit-Tests für `maskMessage` + `validateRegexPattern` (Chat-Wortfilter).
 *
 * Reine Funktionen ohne DB:
 *   - Literal: case-insensitiver Substring → `***`, Metazeichen escaped.
 *   - Regex: RE2-Muster, zeilenweise (kein Treffer über \r/\n), case-insensitiv.
 *   - Validierung: ungültige/nicht unterstützte/Leerstring-Muster werden abgelehnt.
 */
import { describe, expect, it } from "vitest";

import { maskMessage, validateRegexPattern } from "../src/modules/chat/banned-words.service.js";

const lit = (word: string) => ({ word, isRegex: false });
const rx = (word: string) => ({ word, isRegex: true });

describe("maskMessage — Literale", () => {
  it("ersetzt einen Treffer durch ***", () => {
    const r = maskMessage("Du bist scheiß doof", [lit("scheiß")]);
    expect(r.clean).toBe("Du bist *** doof");
    expect(r.matched).toEqual(["scheiß"]);
  });

  it("ist case-insensitive", () => {
    const r = maskMessage("Was SCHEIßE!", [lit("scheiß")]);
    expect(r.clean).toBe("Was ***E!");
    expect(r.matched).toEqual(["scheiß"]);
  });

  it("ersetzt mehrere verschiedene Wörter", () => {
    const r = maskMessage("Du fuck nochmal, ist scheiß!", [lit("fuck"), lit("scheiß")]);
    expect(r.clean).toBe("Du *** nochmal, ist ***!");
    expect(r.matched.sort()).toEqual(["fuck", "scheiß"]);
  });

  it("ersetzt mehrere Vorkommen desselben Worts", () => {
    const r = maskMessage("fuck fuck fuck", [lit("fuck")]);
    expect(r.clean).toBe("*** *** ***");
    expect(r.matched).toEqual(["fuck"]);
  });

  it("liefert Body unverändert zurück, wenn nichts matcht", () => {
    const r = maskMessage("Alles ganz lieb hier", [lit("fuck"), lit("scheiß")]);
    expect(r.clean).toBe("Alles ganz lieb hier");
    expect(r.matched).toEqual([]);
  });

  it("leere Liste → Body unverändert", () => {
    const r = maskMessage("Da steht ein böses Wort", []);
    expect(r.clean).toBe("Da steht ein böses Wort");
    expect(r.matched).toEqual([]);
  });

  it("Regex-Sonderzeichen im Literal werden escaped (kein Pattern-Bug)", () => {
    const r = maskMessage("Hallo, gib mir 2+3 Sterne", [lit(".+")]);
    expect(r.clean).toBe("Hallo, gib mir 2+3 Sterne");
    expect(r.matched).toEqual([]);
  });

  it("leere Wörter werden übersprungen", () => {
    const r = maskMessage("ein normaler Satz", [lit("")]);
    expect(r.clean).toBe("ein normaler Satz");
    expect(r.matched).toEqual([]);
  });
});

describe("maskMessage — Regex (RE2)", () => {
  it("maskiert Ziffernfolgen mit \\d+", () => {
    const r = maskMessage("Ruf an: 0664 1234567", [rx("\\d+")]);
    expect(r.clean).toBe("Ruf an: *** ***");
    expect(r.matched).toEqual(["\\d+"]);
  });

  it("ist case-insensitive", () => {
    const r = maskMessage("FOO und foo", [rx("foo")]);
    expect(r.clean).toBe("*** und ***");
  });

  it("respektiert Wortgrenzen \\b", () => {
    const r = maskMessage("classic class", [rx("\\bclass\\b")]);
    expect(r.clean).toBe("classic ***");
  });

  it("matcht NICHT über einen Zeilenumbruch hinweg", () => {
    const r = maskMessage("foo\nbar", [rx("foo.*bar")]);
    expect(r.clean).toBe("foo\nbar");
    expect(r.matched).toEqual([]);
  });

  it("maskiert pro Zeile und lässt andere Zeilen unberührt (\\r\\n erhalten)", () => {
    const r = maskMessage("hallo 123\r\nwelt", [rx("\\d+")]);
    expect(r.clean).toBe("hallo ***\r\nwelt");
  });

  it("mischt Literal- und Regex-Einträge", () => {
    const r = maskMessage("idiot 42", [lit("idiot"), rx("\\d+")]);
    expect(r.clean).toBe("*** ***");
    expect(r.matched.sort()).toEqual(["\\d+", "idiot"]);
  });
});

describe("validateRegexPattern", () => {
  it("akzeptiert gültige RE2-Muster", () => {
    expect(validateRegexPattern("\\d+")).toBeNull();
    expect(validateRegexPattern("[a-z]{2,5}")).toBeNull();
    expect(validateRegexPattern("\\bfoo\\b")).toBeNull();
  });

  it("lehnt syntaktisch ungültige Muster ab", () => {
    expect(validateRegexPattern("(")).toMatch(/ungültig|nicht unterstützt/i);
  });

  it("lehnt Rückbezüge ab (von RE2 nicht unterstützt)", () => {
    expect(validateRegexPattern("(a)\\1")).not.toBeNull();
  });

  it("lehnt Lookaround ab (von RE2 nicht unterstützt)", () => {
    expect(validateRegexPattern("a(?=b)")).not.toBeNull();
  });

  it("lehnt Muster ab, die auf den Leerstring passen", () => {
    expect(validateRegexPattern("a*")).toMatch(/Leerstring/);
  });
});
