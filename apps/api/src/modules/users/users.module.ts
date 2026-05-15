import { Module } from "@nestjs/common";

import { OptionalSessionGuard } from "../../common/guards/optional-session.guard.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, SessionGuard, OptionalSessionGuard],
  exports: [UsersService],
})
export class UsersModule {}
