/**
 * /api/users — eigenes Profil lesen/schreiben, fremde Profile gefiltert lesen.
 *
 * `name` (Spitzname) und `email` werden hier NICHT geändert. Dafür gibt es:
 *   - Spitzname-Wechsel: PATCH /api/auth/update-user (Better Auth, prüft Unique)
 *   - Email-Wechsel:     POST /api/auth/change-email (Better Auth, mit Verify-Mail)
 * Wir routen nicht dupliziert durch, damit Verify-Logiken nicht auseinanderdriften.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { OptionalSessionGuard } from "../../common/guards/optional-session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import { FriendsService, type FriendStatusOut, type FriendsList } from "./friends.service.js";
import { GdprService } from "./gdpr.service.js";
import { UpdateProfileDtoSchema, type UpdateProfileDto } from "./users.dto.js";
import { UsersService, type MyProfileView, type PublicProfileView } from "./users.service.js";

@Controller("api/users")
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly gdpr: GdprService,
    private readonly friends: FriendsService
  ) {}

  @Get("me")
  @UseGuards(SessionGuard)
  async getMe(@Req() req: FastifyRequest): Promise<MyProfileView> {
    // SessionGuard hat req.user bereits gesetzt — der Type-Definition-Augment
    // in session.guard.ts macht das für TS sichtbar.
    return this.users.getMyProfile(req.user!.id);
  }

  @Patch("me")
  @UseGuards(SessionGuard)
  async patchMe(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(UpdateProfileDtoSchema)) dto: UpdateProfileDto
  ): Promise<MyProfileView> {
    return this.users.updateMyProfile(req.user!.id, dto);
  }

  /**
   * DSGVO-Datenexport (Art. 20). Liefert eine JSON-Datei mit allen
   * personenbezogenen Daten des eingeloggten Users. `Content-Disposition: attachment`
   * triggert im Browser einen Download statt einer Inline-Anzeige.
   */
  @Get("me/export")
  @UseGuards(SessionGuard)
  async exportMyData(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const data = await this.gdpr.exportAllData(req.user!.id);
    const filename = `heb-ab-export-${req.user!.id}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    void reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(data);
  }

  /**
   * DSGVO-Recht-auf-Löschung (Art. 17): anonymisiert den Account. Hard-
   * Delete ist hier bewusst nicht erlaubt — Spiele und Audit-Trails sind
   * für die Community/Compliance relevant. Stattdessen werden alle PII-
   * Felder geleert, der Spielername durch einen Hash ersetzt, Sessions
   * widerrufen.
   *
   * Liefert 204; der Client muss anschließend selbst zur Login-Seite
   * navigieren, weil die Session weg ist.
   */
  @Delete("me")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async deleteMe(@Req() req: FastifyRequest): Promise<void> {
    await this.gdpr.softDelete(req.user!.id);
  }

  // ─── Freundschaften ──────────────────────────────────────────────

  @Get("me/friends")
  @UseGuards(SessionGuard)
  async listFriends(@Req() req: FastifyRequest): Promise<FriendsList> {
    return this.friends.listMine(req.user!.id);
  }

  @Get(":id/friend-status")
  @UseGuards(SessionGuard)
  async friendStatus(
    @Req() req: FastifyRequest,
    @Param("id") targetId: string
  ): Promise<{ status: FriendStatusOut }> {
    const status = await this.friends.getStatus(req.user!.id, targetId);
    return { status };
  }

  @Post(":id/friend-request")
  @UseGuards(SessionGuard)
  async sendRequest(
    @Req() req: FastifyRequest,
    @Param("id") targetId: string
  ): Promise<{ ok: true }> {
    await this.friends.sendRequest(req.user!.id, targetId);
    return { ok: true };
  }

  @Post(":id/friend-accept")
  @UseGuards(SessionGuard)
  async acceptRequest(
    @Req() req: FastifyRequest,
    @Param("id") targetId: string
  ): Promise<{ ok: true }> {
    await this.friends.accept(req.user!.id, targetId);
    return { ok: true };
  }

  @Delete(":id/friend")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async removeFriend(@Req() req: FastifyRequest, @Param("id") targetId: string): Promise<void> {
    await this.friends.remove(req.user!.id, targetId);
  }

  @Get(":id")
  @UseGuards(OptionalSessionGuard)
  async getPublic(
    @Req() req: FastifyRequest,
    @Param("id") targetId: string
  ): Promise<PublicProfileView> {
    return this.users.getPublicProfile(req.user?.id ?? null, targetId);
  }
}
