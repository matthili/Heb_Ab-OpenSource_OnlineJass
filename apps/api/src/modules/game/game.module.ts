import { Module } from "@nestjs/common";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { ChatModule } from "../chat/chat.module.js";
import { AfkService } from "./afk.service.js";
import { BodenseeGameService } from "./bodensee-game.service.js";
import { DisconnectVoteService } from "./disconnect-vote.service.js";
import { GameController } from "./game.controller.js";
import { GameGateway } from "./game.gateway.js";
import { GameLockService } from "./game-lock.service.js";
import { GameService } from "./game.service.js";
import { PerUserSocketRegistry } from "./per-user-socket-registry.service.js";
import { ReplayService } from "./replay.service.js";
import { AIPlayerFactory } from "./players/ai-player.factory.js";

@Module({
  imports: [AuthModule, ChatModule],
  controllers: [GameController],
  providers: [
    GameService,
    BodenseeGameService,
    ReplayService,
    GameGateway,
    GameLockService,
    PerUserSocketRegistry,
    DisconnectVoteService,
    AfkService,
    AIPlayerFactory,
    SessionGuard,
  ],
  exports: [
    GameService,
    BodenseeGameService,
    ReplayService,
    DisconnectVoteService,
    PerUserSocketRegistry,
    AfkService,
    // Vom LobbyService genutzt: Bodensee-KI nach freiwilligem Verlassen
    // antreiben (Broadcast + AI-Loop liegen im Gateway).
    GameGateway,
  ],
})
export class GameModule {}
