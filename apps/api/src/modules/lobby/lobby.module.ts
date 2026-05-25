import { Module } from "@nestjs/common";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { GameModule } from "../game/game.module.js";
import { AutoFillService } from "./auto-fill.service.js";
import { LobbyController } from "./lobby.controller.js";
import { LobbyGateway } from "./lobby.gateway.js";
import { LobbyService } from "./lobby.service.js";
import { LobbySettingsService } from "./lobby-settings.service.js";
import { PresenceService } from "./presence.service.js";
import { RematchController } from "./rematch.controller.js";

@Module({
  // GameModule exportiert GameService, den LobbyService für den Auto-
  // Spielstart aus einem vollen Tisch braucht (M6-C).
  imports: [AuthModule, GameModule],
  // RematchController liegt bewusst unter /api/games (semantisch
  // Game-bezogen), wird aber vom LobbyService gehandhabt (M6-E).
  controllers: [LobbyController, RematchController],
  // AutoFillService nach LobbyService listen — Nest auflöst die forwardRef
  // dann ohne Boot-Probleme. AutoFillService ist NICHT exportiert; nur als
  // Modul-intern aktiv (OnModuleInit startet den Sweeper, tick() ist nur
  // für Integration-Tests via app.get(AutoFillService) erreichbar).
  providers: [
    LobbyService,
    AutoFillService,
    LobbyGateway,
    LobbySettingsService,
    PresenceService,
    SessionGuard,
  ],
  // LobbySettingsService wird auch vom AdminController genutzt → exportieren.
  exports: [LobbyService, AutoFillService, LobbyGateway, LobbySettingsService, PresenceService],
})
export class LobbyModule {}
