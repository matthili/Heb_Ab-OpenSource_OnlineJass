/**
 * Unit-Test der reinen Mail-Helfer:
 *   - `parseNoReply`: Env SMTP_NO_REPLY → bool (Default true).
 *   - `replyPolicyNote`: passende Fußnote je nach No-Reply-Status.
 */
import { describe, expect, it } from "vitest";

import { parseNoReply, replyPolicyNote } from "../src/modules/mail/mail.service.js";

describe("parseNoReply", () => {
  it("unbekannt/leer → true (Default)", () => {
    expect(parseNoReply(undefined)).toBe(true);
    expect(parseNoReply("")).toBe(true);
    expect(parseNoReply("  ")).toBe(true);
  });

  it("0/false/no/off (case-insensitiv) → false", () => {
    for (const v of ["0", "false", "FALSE", "no", "Off", " false "]) {
      expect(parseNoReply(v)).toBe(false);
    }
  });

  it("true/1/sonstiges → true", () => {
    for (const v of ["1", "true", "yes", "ja"]) {
      expect(parseNoReply(v)).toBe(true);
    }
  });
});

describe("replyPolicyNote", () => {
  it("No-Reply → Hinweis, dass Antworten verworfen werden", () => {
    expect(replyPolicyNote(true)).toMatch(/No-Reply|nicht gelesen|verworfen/);
  });

  it("überwacht → Einladung zu antworten", () => {
    expect(replyPolicyNote(false)).toMatch(/antworten/i);
  });
});
