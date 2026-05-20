/**
 * Zod-DTOs für die Lobby-REST-Endpunkte.
 *
 * Validation-Strategie: jeder Endpoint, der Eingaben annimmt, hat ein
 * eigenes Schema. `.strict()` weist unbekannte Felder ab — das schützt
 * vor Tippfehlern im Client und macht das Schema zur einzigen
 * Schnittstelle-Wahrheit.
 */
import { z } from "zod";

const AiSeatTypeSchema = z
  .string()
  .regex(
    /^(random|heuristic|nn(-.+)?)$/,
    "aiSeatType must be 'random', 'heuristic', 'nn' or 'nn-<version>'"
  );

const JoinModeSchema = z.enum(["OPEN", "REQUEST", "INVITE"]);
const RestartModeSchema = z.enum(["WELI", "SIEGER_GIBT"]);
// Spielarten: Kreuz-Jass (4er-Team, 4 Sitze), Solo-Jass (jeder gegen jeden,
// 4 Sitze) und Bodensee-Jass (2 Spieler). KREUZ_6P / KREUZ_STEIGERN folgen.
const VariantEnumSchema = z.enum(["KREUZ_4P", "SOLO_4P", "BODENSEE_2P"]);

/**
 * Tisch öffnen. Eröffner sitzt auf Sitz 0. Optional können KI-Sitze direkt
 * vorbelegt werden — z.B. „Ich möchte allein mit 3 KIs spielen": dann
 * `initialAiSeats: [{seat:1},{seat:2},{seat:3}]`. Wenn dabei der `aiSeatType`
 * weggelassen wird, übernimmt der Sitz den Tisch-Default (`aiSeatType`-Feld).
 */
export const OpenTableDtoSchema = z
  .object({
    joinMode: JoinModeSchema.default("OPEN"),
    variant: VariantEnumSchema.default("KREUZ_4P"),
    /** Default-KI-Typ für Auto-Fill und initial besetzte KI-Sitze. */
    aiSeatType: AiSeatTypeSchema.default("heuristic"),
    /**
     * Auto-Fill-Frist in Sekunden. `null` = nie, Owner muss manuell starten.
     * Default 30s entspricht Plan-Doc §3.
     */
    autoFillSeconds: z.number().int().min(5).max(600).nullable().default(30),
    restartMode: RestartModeSchema.default("SIEGER_GIBT"),
    /**
     * **Punkteziel** für die Partie. Sobald ein Team kumulativ über alle
     * Spiele am Tisch diese Punkte erreicht, ist die Partie gewonnen
     * (LobbyTableStatus.MATCH_OVER). Vorarlberger Kreuz-Jass spielt
     * typischerweise auf 1000 oder 1200; wir lassen freie Wahl zwischen 500
     * und 5000.
     */
    targetScore: z.number().int().min(500).max(5000).default(1000),
    /**
     * Optional vorbelegte KI-Sitze (für „Ich + 3 KIs"-Szenario). Sitz 0 darf
     * nicht enthalten sein — der gehört dem Owner. Doppelte Sitz-Nummern
     * lehnen wir mit einer Refine-Regel ab.
     */
    initialAiSeats: z
      .array(
        z
          .object({
            seat: z.number().int().min(1).max(3),
            aiSeatType: AiSeatTypeSchema.optional(),
          })
          .strict()
      )
      .max(3)
      .default([])
      .refine(
        (s) => new Set(s.map((x) => x.seat)).size === s.length,
        "initialAiSeats darf keine doppelten Sitz-Nummern haben"
      ),
  })
  .strict()
  .refine(
    (v) => {
      // Bodensee-Jass hat nur Sitz 0 (Owner) + Sitz 1 — höhere Sitz-Nummern
      // existieren bei dieser Spielart nicht.
      const maxSeat = v.variant === "BODENSEE_2P" ? 1 : 3;
      return v.initialAiSeats.every((s) => s.seat <= maxSeat);
    },
    { message: "initialAiSeats enthält einen Sitz, den diese Spielart nicht hat" }
  );
export type OpenTableDto = z.infer<typeof OpenTableDtoSchema>;

/**
 * Tisch-Settings nachträglich ändern. Alle Felder optional — der Client
 * schickt nur, was er ändern will. Owner-only (Controller-Guard).
 */
export const UpdateTableSettingsDtoSchema = z
  .object({
    joinMode: JoinModeSchema.optional(),
    aiSeatType: AiSeatTypeSchema.optional(),
    autoFillSeconds: z.number().int().min(5).max(600).nullable().optional(),
    restartMode: RestartModeSchema.optional(),
    targetScore: z.number().int().min(500).max(5000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Mindestens ein Settings-Feld muss angegeben sein");
export type UpdateTableSettingsDto = z.infer<typeof UpdateTableSettingsDtoSchema>;

/**
 * Einladung versenden. Entweder per Benutzer-ID oder per Display-Name; einer
 * von beiden muss gesetzt sein. Wir bevorzugen `userId`, falls beide
 * geliefert werden (eindeutiger).
 */
export const InviteUserDtoSchema = z
  .object({
    inviteeUserId: z.string().min(1).optional(),
    inviteeName: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.inviteeUserId) || Boolean(v.inviteeName),
    "Entweder inviteeUserId oder inviteeName muss gesetzt sein"
  );
export type InviteUserDto = z.infer<typeof InviteUserDtoSchema>;

/**
 * Re-Match-Vote nach einem beendeten Game. Jeder menschliche Sitz votet
 * einmal. Alle YES → neues Game wird gestartet. Mind. 1 NO → Tisch zurück
 * nach WAITING, NO-Voter werden vom Tisch entfernt.
 */
export const RematchVoteDtoSchema = z
  .object({
    vote: z.enum(["YES", "NO"]),
  })
  .strict();
export type RematchVoteDto = z.infer<typeof RematchVoteDtoSchema>;

/**
 * Lobby-Listen-Filter. Default: alle WAITING + POST_GAME (= „beitretbare").
 * `mine: true` schränkt auf Tische ein, in denen der Caller selbst sitzt
 * oder die er besitzt — nützlich für die „Meine Tische"-Übersicht.
 */
export const ListTablesQuerySchema = z
  .object({
    status: z
      .union([
        z.enum(["WAITING", "IN_GAME", "POST_GAME", "MATCH_OVER", "CLOSED"]),
        z.array(z.enum(["WAITING", "IN_GAME", "POST_GAME", "MATCH_OVER", "CLOSED"])),
      ])
      .optional(),
    joinMode: JoinModeSchema.optional(),
    mine: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .optional(),
  })
  .strict();
export type ListTablesQuery = z.infer<typeof ListTablesQuerySchema>;
