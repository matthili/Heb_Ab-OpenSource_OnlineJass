import { Module } from "@nestjs/common";

import { OptionalSessionGuard } from "../../common/guards/optional-session.guard.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { FriendsService } from "./friends.service.js";
import { GdprService } from "./gdpr.service.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [UsersController],
  providers: [UsersService, GdprService, FriendsService, SessionGuard, OptionalSessionGuard],
  exports: [UsersService, GdprService, FriendsService],
})
export class UsersModule {}
