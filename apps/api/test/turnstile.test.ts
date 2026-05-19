/**
 * Tests für TurnstileService.verify(). Wir mocken global.fetch, weil
 * der echte Cloudflare-Endpoint im Unit-Test nichts zu suchen hat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TurnstileService } from "../src/modules/auth/turnstile.service.js";

describe("TurnstileService", () => {
  const svc = new TurnstileService();
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env["TURNSTILE_SECRET_KEY"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("Dev-Bypass: ohne TURNSTILE_SECRET_KEY liefert ok:true (kein Netzwerk-Call)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const r = await svc.verify("any-token", "1.2.3.4");
    expect(r.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Fehlt das Token, aber Secret ist gesetzt → ok:false, errors enthält missing-input-response", async () => {
    process.env["TURNSTILE_SECRET_KEY"] = "test-secret";
    const r = await svc.verify(undefined, null);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("missing-input-response");
  });

  it("Cloudflare meldet success:true → ok:true", async () => {
    process.env["TURNSTILE_SECRET_KEY"] = "test-secret";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true }),
    })) as unknown as typeof fetch;
    const r = await svc.verify("valid-token", "1.2.3.4");
    expect(r.ok).toBe(true);
  });

  it("Cloudflare meldet success:false → ok:false + reicht error-codes durch", async () => {
    process.env["TURNSTILE_SECRET_KEY"] = "test-secret";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    })) as unknown as typeof fetch;
    const r = await svc.verify("replayed-token", "1.2.3.4");
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("timeout-or-duplicate");
  });

  it("Bei HTTP-Fehler (5xx) von Cloudflare → ok:false (Fail-Closed)", async () => {
    process.env["TURNSTILE_SECRET_KEY"] = "test-secret";
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const r = await svc.verify("any", "1.2.3.4");
    expect(r.ok).toBe(false);
  });

  it("Bei Netzwerk-Fehler → ok:false (Fail-Closed, kein stilles Pass-Through)", async () => {
    process.env["TURNSTILE_SECRET_KEY"] = "test-secret";
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await svc.verify("any", "1.2.3.4");
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("network-error");
  });

  it("schickt remoteip mit, wenn clientIp gesetzt ist", async () => {
    process.env["TURNSTILE_SECRET_KEY"] = "test-secret";
    let capturedBody = "";
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? "";
      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    }) as unknown as typeof fetch;
    await svc.verify("token", "203.0.113.42");
    expect(capturedBody).toContain("remoteip=203.0.113.42");
  });
});
