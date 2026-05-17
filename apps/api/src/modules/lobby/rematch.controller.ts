/**
 * Re-Match-Vote-Endpoint. Liegt bewusst unter `/api/games/...` (semantisch
 * gehört der Vote zu einem konkreten Game), wird aber vom LobbyService
 * gehandhabt und im LobbyModule registriert — der Controller ist nur die
 * HTTP-Brücke.
 *
 * Mehrere Controller mit dem gleichen Prefix `/api/games` sind in NestJS
 * unproblematisch, solange die Methoden-Pfade unterschiedlich sind. Der
 * `GameController` im GameModule bleibt für `GET /api/games/:id`
 * (Eigensicht); der `RematchController` ergänzt `POST .../rematch-vote`.
 */
import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import { RematchVoteDtoSchema, type RematchVoteDto } from "./lobby.dto.js";
import { LobbyService } from "./lobby.service.js";

@Controller("api/games")
@UseGuards(SessionGuard)
export class RematchController {
  constructor(private readonly lobby: LobbyService) {}

  @Post(":id/rematch-vote")
  async vote(
    @Req() req: FastifyRequest,
    @Param("id") gameId: string,
    @Body(new ZodValidationPipe(RematchVoteDtoSchema)) dto: RematchVoteDto
  ): Promise<
    | { kind: "pending"; remainingVotes: number }
    | { kind: "rematch-started"; gameId: string; starter: number }
    | { kind: "back-to-waiting"; removedUserIds: string[] }
  > {
    return this.lobby.voteRematch(gameId, req.user!.id, dto);
  }
}
