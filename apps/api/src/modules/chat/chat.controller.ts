/**
 * REST-Endpunkte für Chat.
 *
 *   - POST /api/chat                                — Nachricht senden
 *   - GET  /api/chat                                — Historie laden (channelKey + before? + limit?)
 *   - GET  /api/chat/conversations                  — DM-Partner-Übersicht (Profil-History)
 *   - GET  /api/chat/conversations/:otherUserId     — voller DM-Verlauf + Spiel-Kontext
 *
 * Nach erfolgreichem Send pusht der Controller selbst via Gateway —
 * dadurch sehen alle Subscriber die Nachricht sofort.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

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
import {
  ConversationsService,
  type ConversationPartner,
  type ConversationView,
} from "./conversations.service.js";

const ConversationQuerySchema = z
  .object({
    /** „all" | „during-game" | „no-game" — Spec: Alle / Spielnachrichten / Lobby-Nachrichten. */
    filter: z.enum(["all", "during-game", "no-game"]).default("all"),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    before: z.string().datetime().optional(),
  })
  .strict();
type ConversationQuery = z.infer<typeof ConversationQuerySchema>;

@Controller("api/chat")
@UseGuards(SessionGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
    private readonly conversations: ConversationsService
  ) {}

  // ─── Profil-Konversations-History ──────────────────────────────────

  @Get("conversations")
  async listConversations(
    @Req() req: FastifyRequest
  ): Promise<{ partners: ConversationPartner[] }> {
    const partners = await this.conversations.listPartners(req.user!.id);
    return { partners };
  }

  @Get("conversations/:otherUserId")
  async getConversation(
    @Req() req: FastifyRequest,
    @Param("otherUserId") otherUserId: string,
    @Query(new ZodValidationPipe(ConversationQuerySchema)) query: ConversationQuery
  ): Promise<ConversationView> {
    return this.conversations.getConversation(req.user!.id, otherUserId, {
      filter: query.filter,
      limit: query.limit,
      ...(query.before !== undefined ? { before: query.before } : {}),
    });
  }

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

  // ─── PN-Empfangsrechte ─────────────────────────────────────────────

  @Get("can-dm/:userId")
  async canDm(
    @Req() req: FastifyRequest,
    @Param("userId") userId: string
  ): Promise<{ allowed: boolean; reason: string | null }> {
    return this.chat.canDm(req.user!.id, userId);
  }

  @Get("dm-blocks")
  async listDmBlocks(@Req() req: FastifyRequest): Promise<{ blockedUserIds: string[] }> {
    return { blockedUserIds: await this.chat.listDmBlocks(req.user!.id) };
  }

  @Post("dm-blocks/:userId")
  async blockDm(
    @Req() req: FastifyRequest,
    @Param("userId") userId: string
  ): Promise<{ ok: true }> {
    await this.chat.blockDm(req.user!.id, userId);
    return { ok: true };
  }

  @Delete("dm-blocks/:userId")
  @HttpCode(204)
  async unblockDm(@Req() req: FastifyRequest, @Param("userId") userId: string): Promise<void> {
    await this.chat.unblockDm(req.user!.id, userId);
  }
}
