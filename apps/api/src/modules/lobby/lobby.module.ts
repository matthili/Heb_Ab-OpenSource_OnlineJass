import { Module } from "@nestjs/common";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { GameModule } from "../game/game.module.js";
import { LobbyController } from "./lobby.controller.js";
import { LobbyService } from "./lobby.service.js";

@Module({
  // GameModule exportiert GameService, den LobbyService für den Auto-
  // Spielstart aus einem vollen Tisch braucht (M6-C).
  imports: [AuthModule, GameModule],
  controllers: [LobbyController],
  providers: [LobbyService, SessionGuard],
  exports: [LobbyService],
})
export class LobbyModule {}
