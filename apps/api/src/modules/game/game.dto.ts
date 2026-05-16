/**
 * Zod-DTOs für Game-REST-Endpunkte.
 */
import { z } from "zod";

const SuitSchema = z.enum(["EICHEL", "SCHELLE", "HERZ", "LAUB"]);

export const CreateGameDtoSchema = z
  .object({
    /**
     * Variante für M4: nur TRUMPF + Trump-Suit. GUMPF/OBEN/UNTEN/SLALOM kommen
     * mit der Trumpf-Ansage-UI in M6.
     */
    variant: z
      .object({
        mode: z.literal("TRUMPF"),
        trump_suit: SuitSchema,
      })
      .strict(),
    /** Wer beginnt? 0..3 — defaults to 0 (= eröffnender User). */
    starter: z.number().int().min(0).max(3).default(0),
    /**
     * Mitspieler-Liste (Sitze 1..3). Sitz 0 ist immer der eröffnende User.
     * Jeder Eintrag: entweder `userId` (eingeloggter Mitspieler) oder
     * `aiSeatType: "random"` (KI). Für M4 erwarten wir 3 Einträge.
     */
    coplayers: z
      .array(
        z.union([
          z.object({ userId: z.string().min(1) }).strict(),
          z
            .object({
              // "random" für RandomLegalMovePlayer (Baseline),
              // "nn" oder "nn-vX.Y.Z" für NN-Inferenz (Microservice).
              aiSeatType: z
                .string()
                .regex(
                  /^(random|nn(-.+)?)$/,
                  "aiSeatType must be 'random', 'nn' or 'nn-<version>'"
                ),
            })
            .strict(),
        ])
      )
      .length(3),
    /** Optional: deterministischer RNG-Seed (nur für Test-Runs). */
    rngSeed: z.number().int().optional(),
  })
  .strict();

export type CreateGameDto = z.infer<typeof CreateGameDtoSchema>;
