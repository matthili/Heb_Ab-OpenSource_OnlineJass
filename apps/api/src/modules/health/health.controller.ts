import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Health- und Readiness-Probes.
 *
 * `/health`  — Liveness: Prozess antwortet, sonst nichts. Pino-AutoLogging
 *              ignoriert diesen Pfad, damit er Logs nicht flutet.
 * `/healthz` — Readiness für k8s: pingt zusätzlich Postgres. Redis kommt in M4
 *              dazu, sobald der Adapter da ist.
 */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("health")
  liveness(): { status: "ok"; ts: string } {
    return { status: "ok", ts: new Date().toISOString() };
  }

  @Get("healthz")
  async readiness(): Promise<{ status: "ok"; ts: string; checks: { postgres: "ok" } }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      throw new HttpException(
        { status: "unavailable", reason: "postgres", error: String(err) },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return { status: "ok", ts: new Date().toISOString(), checks: { postgres: "ok" } };
  }
}
