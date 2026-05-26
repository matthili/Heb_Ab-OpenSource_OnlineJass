/**
 * Öffentlicher Leaderboard-Endpunkt.
 *
 * Spec: „Globales Leaderboard (Opt-in pro Nutzer)". Kein SessionGuard — die
 * Liste ist bewusst öffentlich; jeder User selbst entscheidet, ob er
 * mitspielt (via `Profile.publicLeaderboard`).
 */
import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";

import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import { LeaderboardService, type LeaderboardEntry } from "./leaderboard.service.js";

const LeaderboardQuerySchema = z
  .object({
    variant: z.enum(["KREUZ_4P", "KREUZ_6P", "KREUZ_STEIGERN", "SOLO_4P", "BODENSEE_2P"]),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

@Controller("api/leaderboard")
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get()
  async get(
    @Query(new ZodValidationPipe(LeaderboardQuerySchema)) query: LeaderboardQuery
  ): Promise<{ variant: string; entries: LeaderboardEntry[] }> {
    const entries = await this.leaderboard.get(query.variant, query.limit);
    return { variant: query.variant, entries };
  }
}
