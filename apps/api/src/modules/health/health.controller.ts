import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import { EventLoopMonitorService } from "./event-loop-monitor.service.js";

/**
 * Health- und Readiness-Probes.
 *
 * `/health`  — Liveness: Prozess antwortet — UND die Event-Schleife hängt nicht
 *              fest. Bei anhaltend hoher Verzögerung (> HEALTH_MAX_EVENT_LOOP_LAG_MS,
 *              Default 1000 ms) liefert sie 503 → Docker-Healthcheck + Autoheal
 *              starten den überlasteten Container neu. Pino-AutoLogging ignoriert
 *              diesen Pfad, damit er Logs nicht flutet.
 * `/healthz` — Readiness für k8s: pingt zusätzlich Postgres.
 */
const MAX_LAG_MS = (() => {
  const n = Number(process.env["HEALTH_MAX_EVENT_LOOP_LAG_MS"]);
  return Number.isFinite(n) && n > 0 ? n : 1000;
})();

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLoop: EventLoopMonitorService
  ) {}

  @Get("health")
  liveness(): { status: "ok"; ts: string; eventLoopLagMs: number } {
    const lagMs = Math.round(this.eventLoop.currentLagMsValue());
    if (lagMs > MAX_LAG_MS) {
      throw new HttpException(
        { status: "degraded", reason: "event-loop", lagMs },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return { status: "ok", ts: new Date().toISOString(), eventLoopLagMs: lagMs };
  }

  @Get("healthz")
  async readiness(): Promise<{ status: "ok"; ts: string; checks: { postgres: "ok" } }> {
    try {
      // ESLint no-restricted-syntax verbietet $queryRaw global.
      // Health-Check ist der einzige legitime Use-Case: ein
      // Tagged-Template ohne User-Input (keine Injection-Fläche),
      // typsichere Prisma-Methoden bieten kein direktes „SELECT 1".
      // eslint-disable-next-line no-restricted-syntax
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
