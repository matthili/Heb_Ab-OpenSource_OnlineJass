import { Module } from "@nestjs/common";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { GameController } from "./game.controller.js";
import { GameGateway } from "./game.gateway.js";
import { GameLockService } from "./game-lock.service.js";
import { GameService } from "./game.service.js";
import { AIPlayerFactory } from "./players/ai-player.factory.js";

@Module({
  imports: [AuthModule],
  controllers: [GameController],
  providers: [GameService, GameGateway, GameLockService, AIPlayerFactory, SessionGuard],
  exports: [GameService],
})
export class GameModule {}
