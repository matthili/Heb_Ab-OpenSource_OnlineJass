import { Module } from "@nestjs/common";

import { EventLoopMonitorService } from "./event-loop-monitor.service.js";
import { HealthController } from "./health.controller.js";

@Module({
  controllers: [HealthController],
  providers: [EventLoopMonitorService],
})
export class HealthModule {}
