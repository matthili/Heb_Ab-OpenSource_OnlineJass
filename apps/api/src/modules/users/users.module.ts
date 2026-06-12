import { Module } from "@nestjs/common";

import { OptionalSessionGuard } from "../../common/guards/optional-session.guard.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ReportsModule } from "../reports/reports.module.js";
import { FriendsService } from "./friends.service.js";
import { GdprService } from "./gdpr.service.js";
import { LeaderboardController } from "./leaderboard.controller.js";
import { LeaderboardService } from "./leaderboard.service.js";
import { SessionsService } from "./sessions.service.js";
import { UserStatsService } from "./user-stats.service.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [AuthModule, AuditModule, ReportsModule],
  controllers: [UsersController, LeaderboardController],
  providers: [
    UsersService,
    GdprService,
    FriendsService,
    SessionsService,
    UserStatsService,
    LeaderboardService,
    SessionGuard,
    OptionalSessionGuard,
  ],
  exports: [
    UsersService,
    GdprService,
    FriendsService,
    SessionsService,
    UserStatsService,
    LeaderboardService,
  ],
})
export class UsersModule {}
