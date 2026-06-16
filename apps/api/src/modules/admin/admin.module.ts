import { Module } from "@nestjs/common";

import { RolesGuard } from "../../common/guards/roles.guard.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { ChatModule } from "../chat/chat.module.js";
import { InferenceModule } from "../inference/inference.module.js";
import { LobbyModule } from "../lobby/lobby.module.js";
import { ReportsModule } from "../reports/reports.module.js";
import { AdminBootstrapService } from "./admin-bootstrap.service.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";

@Module({
  // MailModule + AuditModule sind beide global registriert, müssen also
  // nicht explizit importiert werden. AuthModule muss rein für den
  // SessionGuard; ChatModule für den BannedWordsService (Chat-Moderation
  // im Admin-Bereich); LobbyModule für den LobbySettingsService
  // (globale Tisch-/Punkte-Einstellungen).
  imports: [AuthModule, ChatModule, LobbyModule, ReportsModule, InferenceModule],
  controllers: [AdminController],
  // AdminBootstrapService hat keinen Controller — er hängt nur am
  // OnApplicationBootstrap-Lifecycle (Erst-Admin-Beförderung via ADMIN_EMAIL).
  providers: [AdminService, AdminBootstrapService, SessionGuard, RolesGuard],
  exports: [AdminService],
})
export class AdminModule {}
