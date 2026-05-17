import { Module } from "@nestjs/common";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { LobbyController } from "./lobby.controller.js";
import { LobbyService } from "./lobby.service.js";

@Module({
  imports: [AuthModule],
  controllers: [LobbyController],
  providers: [LobbyService, SessionGuard],
  exports: [LobbyService],
})
export class LobbyModule {}
