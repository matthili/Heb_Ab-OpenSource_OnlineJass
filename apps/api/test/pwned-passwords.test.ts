/**
 * Unit-Tests für `checkPasswordBreached` (HIBP-Range-API-Client).
 *
 * Wir stubben `fetch` per Option-Injection — kein echter Netz-Aufruf in der
 * Test-Suite. Die k-Anonymity-Logik (SHA-1 → Prefix/Suffix → Match in der
 * Range-Response) lässt sich so deterministisch prüfen, ohne von der echten
 * HIBP-API abhängig zu sein.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkPasswordBreached } from "../src/modules/auth/pwned-passwords.js";

/** SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 (well-known). */
const PASSWORD = "password";
const SHA1_PASSWORD_UPPER = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";
const PASSWORD_PREFIX = SHA1_PASSWORD_UPPER.slice(0, 5); // "5BAA6"
const PASSWORD_SUFFIX = SHA1_PASSWORD_UPPER.slice(5); //    "1E4C9B93F3F0682250B6CF8331B7EE68FD8"

function makeRangeResponse(entries: Array<[suffix: string, count: number]>): string {
  return entries.map(([s, c]) => `${s}:${c}`).join("\r\n");
}

describe("checkPasswordBreached (HIBP)", () => {
  beforeEach(() => {
    delete process.env["DISABLE_HIBP_CHECK"];
  });

  afterEach(() => {
    delete process.env["DISABLE_HIBP_CHECK"];
    vi.restoreAllMocks();
  });

  it("erkennt ein in der Range-Response gelistetes Passwort als pwned (mit Count)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        makeRangeResponse([
          ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 1],
          [PASSWORD_SUFFIX, 12345678],
          ["ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", 7],
        ]),
        { status: 200 }
      )
    );
    const result = await checkPasswordBreached(PASSWORD, { fetchImpl: fetchMock });
    expect(result.pwned).toBe(true);
    expect(result.count).toBe(12345678);

    // Verifiziert: nur den Prefix verschickt, niemals den vollen Suffix.
    // (Die Klartext-Substring-Probe gegen "password" geht nicht, weil
    // "pwnedpasswords.com" das Wort enthält — die exakte URL-Gleichheit
    // beweist dasselbe sauberer.)
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PASSWORD_PREFIX}`);
    expect(url).not.toContain(PASSWORD_SUFFIX);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Add-Padding"]).toBe("true");
  });

  it("liefert pwned=false, wenn der Suffix nicht in der Response steht", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        makeRangeResponse([
          ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 1],
          ["ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", 7],
        ]),
        { status: 200 }
      )
    );
    const result = await checkPasswordBreached("ein-passwort-das-niemand-leaked-hat-xyz-9876", {
      fetchImpl: fetchMock,
    });
    expect(result.pwned).toBe(false);
    expect(result.count).toBeUndefined();
  });

  it("Suffix-Match ist case-insensitive (HIBP liefert Uppercase, defensive)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(makeRangeResponse([[PASSWORD_SUFFIX.toLowerCase(), 42]]), { status: 200 })
      );
    const result = await checkPasswordBreached(PASSWORD, { fetchImpl: fetchMock });
    expect(result.pwned).toBe(true);
    expect(result.count).toBe(42);
  });

  it("Fail-open: HTTP-Fehler-Status → pwned=false mit error='status'", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Service Unavailable", { status: 503 }));
    const result = await checkPasswordBreached(PASSWORD, { fetchImpl: fetchMock });
    expect(result.pwned).toBe(false);
    expect(result.error).toBe("status");
  });

  it("Fail-open: Netzwerkfehler → pwned=false mit error='network'", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed: connect ENETUNREACH"));
    const result = await checkPasswordBreached(PASSWORD, { fetchImpl: fetchMock });
    expect(result.pwned).toBe(false);
    expect(result.error).toBe("network");
  });

  it("Fail-open: Timeout/Abort → pwned=false mit error='timeout'", async () => {
    // fetch löst NIE auf → AbortController triggert nach timeoutMs
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal!;
        if (signal.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const result = await checkPasswordBreached(PASSWORD, { fetchImpl: fetchMock, timeoutMs: 30 });
    expect(result.pwned).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("DISABLE_HIBP_CHECK=1 → short-circuit ohne fetch-Aufruf", async () => {
    process.env["DISABLE_HIBP_CHECK"] = "1";
    const fetchMock = vi.fn();
    const result = await checkPasswordBreached(PASSWORD, { fetchImpl: fetchMock });
    expect(result.pwned).toBe(false);
    expect(result.error).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leeres Passwort → pwned=false ohne fetch-Aufruf (defensiv)", async () => {
    const fetchMock = vi.fn();
    const result = await checkPasswordBreached("", { fetchImpl: fetchMock });
    expect(result.pwned).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Worst-Case-Passwort 'password' triggert die richtige Prefix/Suffix-Trennung", async () => {
    // Robustheits-Test gegen einen Refactoring-Fehler bei der Hash-Aufteilung.
    let capturedUrl = "";
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response("", { status: 200 }));
    });
    await checkPasswordBreached(PASSWORD, { fetchImpl: fetchMock });
    expect(capturedUrl).toMatch(/\/range\/5BAA6$/);
  });
});
