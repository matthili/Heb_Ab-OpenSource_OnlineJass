/**
 * /api/users — eigenes Profil lesen/schreiben, fremde Profile gefiltert lesen.
 *
 * `name` (Spitzname) und `email` werden hier NICHT geändert. Dafür gibt es:
 *   - Spitzname-Wechsel: PATCH /api/auth/update-user (Better Auth, prüft Unique)
 *   - Email-Wechsel:     POST /api/auth/change-email (Better Auth, mit Verify-Mail)
 * Wir routen nicht dupliziert durch, damit Verify-Logiken nicht auseinanderdriften.
 */
import { Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { OptionalSessionGuard } from "../../common/guards/optional-session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import { UpdateProfileDtoSchema, type UpdateProfileDto } from "./users.dto.js";
import { UsersService, type MyProfileView, type PublicProfileView } from "./users.service.js";

@Controller("api/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

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

  @Get(":id")
  @UseGuards(OptionalSessionGuard)
  async getPublic(
    @Req() req: FastifyRequest,
    @Param("id") targetId: string
  ): Promise<PublicProfileView> {
    return this.users.getPublicProfile(req.user?.id ?? null, targetId);
  }
}
