/**
 * Tests für OriginCheckGuard — die zentrale CSRF-Abwehr.
 *
 * Wir mocken `AuditService` (keine DB), simulieren `ExecutionContext`
 * mit verschiedenen Method/Origin-Kombinationen und prüfen Pass/Reject.
 */
import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OriginCheckGuard } from "../src/common/guards/origin-check.guard.js";
import type { AuditService } from "../src/modules/audit/audit.service.js";

const FAKE_AUDIT = { record: vi.fn(async () => undefined) } as unknown as AuditService;

function makeCtx(opts: { method: string; origin?: string; url?: string }): ExecutionContext {
  const headers: Record<string, string> = {};
  if (opts.origin !== undefined) headers["origin"] = opts.origin;
  const req = {
    method: opts.method,
    url: opts.url ?? "/api/lobby/tables",
    headers,
    ip: "127.0.0.1",
  };
  return {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe("OriginCheckGuard", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Trust-Liste auf Test-Defaults
    process.env["NODE_ENV"] = "production";
    process.env["BETTER_AUTH_URL"] = "https://api.example.com";
    process.env["WEB_PUBLIC_URL"] = "https://app.example.com";
    process.env["LANDING_PUBLIC_URL"] = "https://example.com";
    delete process.env["TRUSTED_ORIGINS"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("lässt GET-Requests immer durch (safe method)", async () => {
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    const ctx = makeCtx({ method: "GET", origin: "https://evil.com" });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(FAKE_AUDIT.record).not.toHaveBeenCalled();
  });

  it("lässt HEAD und OPTIONS durch (Preflight + Probe)", async () => {
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    expect(await guard.canActivate(makeCtx({ method: "HEAD" }))).toBe(true);
    expect(
      await guard.canActivate(makeCtx({ method: "OPTIONS", origin: "https://evil.com" }))
    ).toBe(true);
  });

  it("akzeptiert POST von trusted origin", async () => {
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    const ctx = makeCtx({ method: "POST", origin: "https://app.example.com" });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("lehnt POST von untrusted origin ab + auditet", async () => {
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    const ctx = makeCtx({ method: "POST", origin: "https://evil.com" });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(FAKE_AUDIT.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.csrf.reject",
        meta: expect.objectContaining({ reason: "untrusted", origin: "https://evil.com" }),
      })
    );
  });

  it("lehnt PATCH/PUT/DELETE von untrusted origin gleich ab", async () => {
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    for (const method of ["PATCH", "PUT", "DELETE"]) {
      await expect(
        guard.canActivate(makeCtx({ method, origin: "https://evil.com" }))
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it("in production: lehnt state-changing Request OHNE Origin-Header ab", async () => {
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    const ctx = makeCtx({ method: "POST" }); // kein origin gesetzt
    await expect(guard.canActivate(ctx)).rejects.toThrow(/Missing Origin/);
    expect(FAKE_AUDIT.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.csrf.reject",
        meta: expect.objectContaining({ reason: "missing" }),
      })
    );
  });

  it("in development: lässt state-changing Request OHNE Origin durch (curl/Postman)", async () => {
    process.env["NODE_ENV"] = "development";
    process.env["BETTER_AUTH_URL"] = "http://localhost:3000";
    process.env["WEB_PUBLIC_URL"] = "http://localhost:5173";
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    expect(await guard.canActivate(makeCtx({ method: "POST" }))).toBe(true);
  });

  it("akzeptiert zusätzliche Origins via TRUSTED_ORIGINS env", async () => {
    process.env["TRUSTED_ORIGINS"] = "https://partner.example.com,https://staging.example.com";
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    const ctx = makeCtx({ method: "POST", origin: "https://staging.example.com" });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("ignoriert Wildcard-Eintrag in TRUSTED_ORIGINS (Sicherheits-Falle)", async () => {
    process.env["TRUSTED_ORIGINS"] = "*";
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    const ctx = makeCtx({ method: "POST", origin: "https://random.example.com" });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("ignoriert Subdomain-Matches (z.B. evil.app.example.com matcht NICHT app.example.com)", async () => {
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    const ctx = makeCtx({ method: "POST", origin: "https://evil.app.example.com" });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("nicht-HTTP-Kontexte (z.B. WebSocket-Handshake) werden durchgewinkt", async () => {
    const guard = new OriginCheckGuard(FAKE_AUDIT);
    const ctx = {
      getType: () => "ws",
    } as unknown as ExecutionContext;
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
