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
import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import { GameService, type PlayerView } from "./game.service.js";
import { ReplayService, type ReplayBundle, type UserGameSummary } from "./replay.service.js";

const SetPublicReplayDtoSchema = z.object({ isPublic: z.boolean() }).strict();
type SetPublicReplayDto = z.infer<typeof SetPublicReplayDtoSchema>;

@Controller("api/games")
export class GameController {
  constructor(
    private readonly games: GameService,
    private readonly replay: ReplayService
  ) {}

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

  /**
   * Replay-Bundle: alles, was der Client braucht, um per `engine.applyMove`
   * jeden Frame des Spiels nachzubauen. Sichtbar nur für Teilnehmer + Admins.
   */
  @Get(":id/replay")
  @UseGuards(SessionGuard)
  async getReplay(@Req() req: FastifyRequest, @Param("id") gameId: string): Promise<ReplayBundle> {
    return this.replay.getReplay(gameId, req.user!.id);
  }

  /**
   * Öffentliches Replay (kein SessionGuard). 404, wenn das Spiel nicht
   * existiert ODER `publicReplay=false` ist — kein Existenz-Leak.
   * Shareable URL: `${frontend}/r/:gameId`.
   */
  @Get(":id/replay/public")
  async getPublicReplay(@Param("id") gameId: string): Promise<ReplayBundle> {
    return this.replay.getPublicReplay(gameId);
  }

  /**
   * Schaltet das `publicReplay`-Flag um. Erlaubt für jeden Teilnehmer
   * (oder Admin). Liefert den neuen Stand zurück.
   */
  @Patch(":id/replay/visibility")
  @UseGuards(SessionGuard)
  async setPublicReplay(
    @Req() req: FastifyRequest,
    @Param("id") gameId: string,
    @Body(new ZodValidationPipe(SetPublicReplayDtoSchema)) dto: SetPublicReplayDto
  ): Promise<{ publicReplay: boolean }> {
    await this.replay.setPublicReplay(gameId, req.user!.id, dto.isPublic);
    return { publicReplay: dto.isPublic };
  }

  /**
   * Eigene Spiel-History — alle Games, an denen der eingeloggte User
   * als Sitz beteiligt war. Sortiert nach `startedAt DESC`.
   *
   * Pagination via `?limit=` und `?offset=` (Defaults: 50/0).
   */
  @Get()
  @UseGuards(SessionGuard)
  async listMine(
    @Req() req: FastifyRequest,
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string
  ): Promise<{ games: UserGameSummary[] }> {
    const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(offsetRaw ?? "0", 10) || 0, 0);
    const games = await this.replay.listUserGames(req.user!.id, limit, offset);
    return { games };
  }
}
