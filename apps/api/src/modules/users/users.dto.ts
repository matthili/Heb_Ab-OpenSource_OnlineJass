/**
 * Zod-DTOs für Profil-Endpunkte. Eine Quelle, sowohl im Backend für die
 * Pipe-Validation als auch (später) im shared-types-Paket fürs Frontend.
 */
import { z } from "zod";

import { VisibilityMapSchema } from "./visibility.js";

const trimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable();

export const UpdateProfileDtoSchema = z
  .object({
    realFirstName: trimmedString(80).optional(),
    realLastName: trimmedString(80).optional(),
    birthDate: z.iso
      .date()
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v))),
    city: trimmedString(120).optional(),
    country: trimmedString(80).optional(),
    hobbies: trimmedString(1000).optional(),
    bio: trimmedString(2000).optional(),
    avatarUrl: z.url().max(2000).nullable().optional(),
    visibility: VisibilityMapSchema.optional(),
    /** Spec „Leaderboard (Opt-in pro Nutzer)". `true` = im öffentlichen Ranking sichtbar. */
    publicLeaderboard: z.boolean().optional(),
    /** PN-Empfangsrecht: von allen (`ALL`) oder nur von Freunden (`FRIENDS`). */
    dmPolicy: z.enum(["ALL", "FRIENDS"]).optional(),
  })
  .strict();

export type UpdateProfileDto = z.infer<typeof UpdateProfileDtoSchema>;
