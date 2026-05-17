/**
 * REST-Endpunkte für Chat.
 *
 *   - POST /api/chat        — Nachricht senden
 *   - GET  /api/chat        — Historie laden (channelKey + before? + limit?)
 *
 * Nach erfolgreichem Send pusht der Controller selbst via Gateway —
 * dadurch sehen alle Subscriber die Nachricht sofort.
 */
import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import {
  ChatHistoryQuerySchema,
  SendChatDtoSchema,
  type ChatHistoryQuery,
  type SendChatDto,
} from "./chat.dto.js";
import { ChatGateway } from "./chat.gateway.js";
import { ChatService, type ChatMessageView } from "./chat.service.js";

@Controller("api/chat")
@UseGuards(SessionGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway
  ) {}

  @Post()
  async send(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(SendChatDtoSchema)) dto: SendChatDto
  ): Promise<ChatMessageView> {
    const view = await this.chat.send(req.user!.id, dto.channelKey, dto.body);
    this.gateway.broadcastMessage(view);
    return view;
  }

  @Get()
  async history(
    @Req() req: FastifyRequest,
    @Query(new ZodValidationPipe(ChatHistoryQuerySchema)) query: ChatHistoryQuery
  ): Promise<{ messages: ChatMessageView[] }> {
    const messages = await this.chat.getHistory(req.user!.id, query.channelKey, {
      limit: query.limit,
      ...(query.before !== undefined ? { before: query.before } : {}),
    });
    return { messages };
  }
}
