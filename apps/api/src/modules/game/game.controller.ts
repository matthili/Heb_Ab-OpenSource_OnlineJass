/**
 * REST-Endpoints rund um ein laufendes Spiel.
 *
 * **Seit M6-C**: `POST /api/games` ist entfernt. Spiele werden ausschließlich
 * über die Lobby erzeugt:
 *   1. `POST /api/lobby/tables` (Tisch öffnen, optional mit `initialAiSeats`)
 *   2. Sobald 4 Sitze belegt sind, startet das Game automatisch.
 *   3. Owner kann den Auto-Fill-Timer mit `POST /api/lobby/tables/:id/start`
 *      überspringen.
 *
 * Der Karten-Spielzug läuft über das Socket.IO-Gateway (siehe `game.gateway`);
 * REST bleibt für stateful-flow ungeeignet.
 */
import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { GameService, type PlayerView } from "./game.service.js";

@Controller("api/games")
export class GameController {
  constructor(private readonly games: GameService) {}

  /**
   * Eigene Sicht auf ein Spiel:
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
