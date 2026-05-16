/**
 * REST-Endpoints für Tisch-Lifecycle.
 *
 * Hier nur Lifecycle-Operationen (Tisch eröffnen, Eigensicht abrufen). Der
 * Karten-Spielzug läuft über das Socket.IO-Gateway (siehe M4-C); REST bleibt
 * für stateful-flow ungeeignet.
 *
 * **M4-Einschränkung:** Es gibt noch keine Lobby-Logik (Tisch auf Anfrage,
 * Einladungs-Modus etc.) — `POST /api/games` legt sofort einen voll
 * besetzten Tisch an, gefüllt mit den Mit-Spielern aus dem Request. Lobby +
 * Beitritts-Modi kommen mit M6.
 */
import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import { CreateGameDtoSchema, type CreateGameDto } from "./game.dto.js";
import { GameService, type PlayerView, type SeatAssignment } from "./game.service.js";

@Controller("api/games")
export class GameController {
  constructor(private readonly games: GameService) {}

  /** Neuen Tisch öffnen. Eröffner sitzt auf Sitz 0. */
  @Post()
  @UseGuards(SessionGuard)
  async create(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(CreateGameDtoSchema)) dto: CreateGameDto
  ): Promise<{ gameId: string }> {
    const ownerId = req.user!.id;
    const seats: SeatAssignment[] = [
      { seat: 0, userId: ownerId, aiSeatType: null },
      ...dto.coplayers.map((p, i): SeatAssignment => {
        if ("userId" in p) return { seat: i + 1, userId: p.userId, aiSeatType: null };
        return { seat: i + 1, userId: null, aiSeatType: p.aiSeatType };
      }),
    ];
    const created = await this.games.createGame({
      variant: dto.variant,
      announcement: { variant: dto.variant, slalom: false },
      starter: dto.starter,
      seats,
      ...(dto.rngSeed !== undefined ? { rngSeed: dto.rngSeed } : {}),
    });
    return created;
  }

  /**
   * Eigene Sicht auf einen Tisch:
   *   - Spielzustand (per-Sitz gefiltert, fremde Hände niemals enthalten)
   *   - Eigene Hand
   *   - Aktions-Maske (welche Karten darf ich gerade spielen?)
   *   - Ist gerade jemand dran, bin ich es?
   *   - End-Score, wenn fertig
   */
  @Get(":id")
  @UseGuards(SessionGuard)
  async getMyView(@Req() req: FastifyRequest, @Param("id") gameId: string): Promise<PlayerView> {
    return this.games.viewForUser(gameId, req.user!.id);
  }
}
