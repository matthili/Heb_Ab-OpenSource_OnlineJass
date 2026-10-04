/**
 * Tests für SessionsService — fokussiert auf die sicherheits-kritischen
 * Punkte (Ownership-Check, IP-Anonymisierung, current-Marker, offene
 * Live-Verbindungen widerrufener Sitzungen werden getrennt).
 *
 * Prisma und UserSocketsService werden vollständig gemockt — keine echte DB nötig.
 */
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { SessionsService } from "../src/modules/users/sessions.service.js";
import type { PrismaService } from "../src/modules/prisma/prisma.service.js";
import type { UserSocketsService } from "../src/modules/realtime/user-sockets.service.js";

function makeSocketsMock() {
  return {
    disconnectUser: vi.fn(),
    disconnectSession: vi.fn(),
    disconnectUserExcept: vi.fn(),
  };
}

function makeService(prisma: PrismaService, sockets = makeSocketsMock()): SessionsService {
  return new SessionsService(prisma, sockets as unknown as UserSocketsService);
}

function makePrismaMock(rows: Array<Record<string, unknown>>) {
  return {
    session: {
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(
        async ({ where: { id } }: { where: { id: string } }) =>
          rows.find((r) => r["id"] === id) ?? null
      ),
      delete: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: rows.length - 1 })),
    },
  } as unknown as PrismaService;
}

describe("SessionsService", () => {
  it("listForUser markiert die aktuelle Session, anonymisiert IPv4 auf /24", async () => {
    const prisma = makePrismaMock([
      {
        id: "sess-A",
        userId: "alice",
        createdAt: new Date("2026-05-01"),
        updatedAt: new Date("2026-05-19"),
        expiresAt: new Date("2026-06-19"),
        userAgent: "Mozilla Chrome",
        ipAddress: "203.0.113.42",
      },
      {
        id: "sess-B",
        userId: "alice",
        createdAt: new Date("2026-05-10"),
        updatedAt: new Date("2026-05-15"),
        expiresAt: new Date("2026-06-15"),
        userAgent: "Mozilla Safari iPad",
        ipAddress: "10.0.0.7",
      },
    ]);
    const svc = makeService(prisma);
    const list = await svc.listForUser("alice", "sess-A");
    expect(list).toHaveLength(2);
    const current = list.find((s) => s.id === "sess-A");
    const other = list.find((s) => s.id === "sess-B");
    expect(current?.current).toBe(true);
    expect(other?.current).toBe(false);
    expect(current?.ipPrefix).toBe("203.0.113.0/24");
    expect(other?.ipPrefix).toBe("10.0.0.0/24");
  });

  it("anonymisiert IPv6 auf /48", async () => {
    const prisma = makePrismaMock([
      {
        id: "s",
        userId: "a",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 1e9),
        userAgent: null,
        ipAddress: "2001:db8:abcd:0012:3456:7890:abcd:ef01",
      },
    ]);
    const list = await makeService(prisma).listForUser("a", "other");
    expect(list[0]?.ipPrefix).toBe("2001:db8:abcd::/48");
  });

  it("null-IP wird zu null ipPrefix", async () => {
    const prisma = makePrismaMock([
      {
        id: "s",
        userId: "a",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 1e9),
        userAgent: null,
        ipAddress: null,
      },
    ]);
    const list = await makeService(prisma).listForUser("a", "other");
    expect(list[0]?.ipPrefix).toBeNull();
  });

  it("revoke verweigert die eigene aktuelle Session", async () => {
    const prisma = makePrismaMock([]);
    const svc = makeService(prisma);
    await expect(svc.revoke("alice", "sess-A", "sess-A")).rejects.toThrow(ForbiddenException);
  });

  it("revoke verweigert Session eines anderen Users (Ownership-Check)", async () => {
    const prisma = makePrismaMock([
      { id: "sess-X", userId: "bob", expiresAt: new Date(Date.now() + 1e9) },
    ]);
    const svc = makeService(prisma);
    await expect(svc.revoke("alice", "sess-X", "sess-current")).rejects.toThrow(NotFoundException);
  });

  it("revoke liefert NotFound (statt Forbidden) bei fremder Session — keine Information-Disclosure", async () => {
    const prisma = makePrismaMock([
      { id: "sess-X", userId: "bob", expiresAt: new Date(Date.now() + 1e9) },
    ]);
    const svc = makeService(prisma);
    // Die Fehler-Klasse muss explizit NotFoundException sein, NICHT ForbiddenException —
    // damit ein Angreifer beim Probieren von Session-IDs nicht erfährt, ob die ID existiert.
    await expect(svc.revoke("alice", "sess-X", "current")).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(svc.revoke("alice", "sess-does-not-exist", "current")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("revokeAllOthers liefert die Anzahl gelöschter Sessions zurück", async () => {
    const prisma = makePrismaMock([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const r = await makeService(prisma).revokeAllOthers("alice", "a");
    // unser mock liefert (rows.length - 1) zurück
    expect(r.revoked).toBe(2);
  });

  it("revoke trennt die Live-Verbindungen genau der widerrufenen Sitzung", async () => {
    const prisma = makePrismaMock([
      { id: "sess-B", userId: "alice", expiresAt: new Date(Date.now() + 1e9) },
    ]);
    const sockets = makeSocketsMock();
    await makeService(prisma, sockets).revoke("alice", "sess-B", "sess-A");
    expect(prisma.session.delete).toHaveBeenCalledWith({ where: { id: "sess-B" } });
    expect(sockets.disconnectSession).toHaveBeenCalledWith("sess-B");
    expect(sockets.disconnectUser).not.toHaveBeenCalled();
  });

  it("revoke trennt nichts, wenn der Widerruf abgelehnt wird", async () => {
    const prisma = makePrismaMock([
      { id: "sess-X", userId: "bob", expiresAt: new Date(Date.now() + 1e9) },
    ]);
    const sockets = makeSocketsMock();
    const svc = makeService(prisma, sockets);
    await expect(svc.revoke("alice", "sess-X", "current")).rejects.toThrow(NotFoundException);
    await expect(svc.revoke("alice", "current", "current")).rejects.toThrow(ForbiddenException);
    expect(sockets.disconnectSession).not.toHaveBeenCalled();
  });

  it("revokeAllOthers trennt alle Live-Verbindungen außer der aktuellen Sitzung", async () => {
    const prisma = makePrismaMock([{ id: "a" }, { id: "b" }]);
    const sockets = makeSocketsMock();
    await makeService(prisma, sockets).revokeAllOthers("alice", "a");
    expect(sockets.disconnectUserExcept).toHaveBeenCalledWith("alice", "a");
    expect(sockets.disconnectUser).not.toHaveBeenCalled();
  });
});
