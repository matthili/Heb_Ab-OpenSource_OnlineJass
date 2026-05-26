import { Global, Module } from "@nestjs/common";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { PushController } from "./push.controller.js";
import { PushService } from "./push.service.js";

@Global()
@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [PushService, SessionGuard],
  exports: [PushService],
})
export class PushModule {}
