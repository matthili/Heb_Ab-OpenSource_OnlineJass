import { Module } from "@nestjs/common";

import { RolesGuard } from "../../common/guards/roles.guard.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";

@Module({
  // MailModule + AuditModule sind beide global registriert, müssen also
  // nicht explizit importiert werden. AuthModule muss rein für den
  // SessionGuard.
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService, SessionGuard, RolesGuard],
  exports: [AdminService],
})
export class AdminModule {}
