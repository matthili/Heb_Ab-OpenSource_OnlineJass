/**
 * Unit-Tests für AuditService.
 *
 * Kern-Vertrag: `record()` ist **fire-and-forget** — selbst wenn die DB-Insert
 * fehlschlägt, darf die Methode nicht werfen. Das ist eine Sicherheitsregel,
 * weil sonst eine DB-Störung Logins komplett unterbinden könnte.
 */
import { describe, expect, it, vi } from "vitest";

import { AuditService } from "../src/modules/audit/audit.service.js";

interface MockPrismaService {
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
}

function makeService(create: MockPrismaService["auditLog"]["create"]): AuditService {
  const mockPrisma: MockPrismaService = { auditLog: { create } };
  // Mock-Prisma anstelle der echten PrismaService-Instanz reinreichen — Strukturtyp passt.
  return new AuditService(mockPrisma as unknown as ConstructorParameters<typeof AuditService>[0]);
}

describe("AuditService.record", () => {
  it("schreibt einen Eintrag mit allen Pflichtfeldern in die DB", async () => {
    const create = vi.fn().mockResolvedValue({});
    const svc = makeService(create);

    await svc.record({
      action: "auth.login.success",
      actorId: "user-1",
      target: "session-42",
      ip: "10.0.0.1",
      meta: { sessionId: "session-42" },
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      data: {
        action: "auth.login.success",
        actorId: "user-1",
        target: "session-42",
        ip: "10.0.0.1",
        meta: { sessionId: "session-42" },
      },
    });
  });

  it("Default-Werte: actorId/target/ip null, meta leeres Objekt", async () => {
    const create = vi.fn().mockResolvedValue({});
    const svc = makeService(create);

    await svc.record({ action: "auth.register.blocked" });

    expect(create).toHaveBeenCalledWith({
      data: {
        action: "auth.register.blocked",
        actorId: null,
        target: null,
        ip: null,
        meta: {},
      },
    });
  });

  it("DB-Insert-Fehler werden geschluckt — Methode wirft nicht", async () => {
    const create = vi.fn().mockRejectedValue(new Error("DB down"));
    const svc = makeService(create);

    await expect(svc.record({ action: "auth.login.success" })).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
  });
});
