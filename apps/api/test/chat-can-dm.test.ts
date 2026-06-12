/**
 * DM-Send-Guard (`ChatService.canDm`) — Policy + Per-Sender-Sperre.
 *
 * `canDm` hängt ausschließlich an Prisma (DmBlock / Profile.dmPolicy /
 * Friendship). Wir mocken Prisma punktgenau und decken die vier relevanten
 * Pfade ab: Self, Block, FRIENDS-ohne-Freundschaft, FRIENDS-mit-Freundschaft
 * sowie den Default ALL.
 */
import { describe, expect, it, vi } from "vitest";

import { ChatService } from "../src/modules/chat/chat.service.js";
import type { PrismaService } from "../src/modules/prisma/prisma.service.js";

interface PrismaMock {
  dmBlock: { findUnique: ReturnType<typeof vi.fn> };
  profile: { findUnique: ReturnType<typeof vi.fn> };
  friendship: { findFirst: ReturnType<typeof vi.fn> };
}

function makeService(overrides: {
  block?: unknown;
  dmPolicy?: "ALL" | "FRIENDS" | null;
  friends?: unknown;
}): ChatService {
  const prisma: PrismaMock = {
    dmBlock: { findUnique: vi.fn().mockResolvedValue(overrides.block ?? null) },
    profile: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          overrides.dmPolicy === undefined ? null : { dmPolicy: overrides.dmPolicy }
        ),
    },
    friendship: { findFirst: vi.fn().mockResolvedValue(overrides.friends ?? null) },
  };
  // redis/audit/bannedWords werden von canDm nicht berührt → leere Stubs.
  return new ChatService(prisma as unknown as PrismaService, {} as never, {} as never, {} as never);
}

describe("ChatService.canDm — PN-Empfangsrechte", () => {
  it("an sich selbst ist immer erlaubt", async () => {
    const svc = makeService({});
    expect(await svc.canDm("u1", "u1")).toEqual({ allowed: true, reason: null });
  });

  it("Per-Sender-Sperre (DmBlock) überschreibt alles", async () => {
    const svc = makeService({ block: { blockerId: "u2" }, dmPolicy: "ALL" });
    expect(await svc.canDm("u1", "u2")).toEqual({ allowed: false, reason: "DM_BLOCKED" });
  });

  it("dmPolicy=FRIENDS ohne Freundschaft → abgelehnt", async () => {
    const svc = makeService({ dmPolicy: "FRIENDS", friends: null });
    expect(await svc.canDm("u1", "u2")).toEqual({ allowed: false, reason: "DM_FRIENDS_ONLY" });
  });

  it("dmPolicy=FRIENDS mit bestätigter Freundschaft → erlaubt", async () => {
    const svc = makeService({ dmPolicy: "FRIENDS", friends: { status: "ACCEPTED" } });
    expect(await svc.canDm("u1", "u2")).toEqual({ allowed: true, reason: null });
  });

  it("dmPolicy=ALL (bzw. kein Profil) → erlaubt", async () => {
    expect(await makeService({ dmPolicy: "ALL" }).canDm("u1", "u2")).toEqual({
      allowed: true,
      reason: null,
    });
    expect(await makeService({}).canDm("u1", "u2")).toEqual({ allowed: true, reason: null });
  });
});
