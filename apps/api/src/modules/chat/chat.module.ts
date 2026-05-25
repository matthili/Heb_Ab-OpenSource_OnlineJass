import { Module } from "@nestjs/common";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { BannedWordsService } from "./banned-words.service.js";
import { ChatCleanupService } from "./chat-cleanup.service.js";
import { ChatController } from "./chat.controller.js";
import { ChatGateway } from "./chat.gateway.js";
import { ChatService } from "./chat.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatCleanupService, BannedWordsService, SessionGuard],
  // BannedWordsService wird vom AdminController genutzt → exportieren.
  exports: [ChatService, ChatGateway, ChatCleanupService, BannedWordsService],
})
export class ChatModule {}
