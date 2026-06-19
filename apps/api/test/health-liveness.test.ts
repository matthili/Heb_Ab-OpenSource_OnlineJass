/**
 * Unit-Test der `/health`-Liveness mit Event-Schleife-Check.
 * Niedrige Verzögerung → 200; anhaltend hohe (> Schwelle) → 503, damit der
 * Docker-Healthcheck + Autoheal einen überlasteten Container neustarten.
 */
import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { HealthController } from "../src/modules/health/health.controller.js";
import type { EventLoopMonitorService } from "../src/modules/health/event-loop-monitor.service.js";
import type { PrismaService } from "../src/modules/prisma/prisma.service.js";

const monitor = (lagMs: number) =>
  ({ currentLagMsValue: () => lagMs }) as unknown as EventLoopMonitorService;
const noPrisma = {} as PrismaService;

describe("HealthController liveness (Event-Loop-Lag)", () => {
  it("liefert ok bei niedriger Verzögerung", () => {
    const ctrl = new HealthController(noPrisma, monitor(4));
    const r = ctrl.liveness();
    expect(r.status).toBe("ok");
    expect(r.eventLoopLagMs).toBe(4);
  });

  it("wirft 503 bei anhaltend hoher Verzögerung (Default-Schwelle 1000 ms)", () => {
    const ctrl = new HealthController(noPrisma, monitor(5000));
    expect(() => ctrl.liveness()).toThrow(HttpException);
  });
});
