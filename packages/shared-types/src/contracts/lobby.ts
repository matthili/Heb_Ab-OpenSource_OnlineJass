/**
 * Lobby-Contracts: REST-DTOs für `/api/lobby/*`.
 *
 * **Single Source of Truth**: dieser Datei vertraut sowohl das Backend
 * (`apps/api/src/modules/lobby/lobby.dto.ts` re-exportiert hier) als auch
 * das Frontend (Web nutzt `z.infer<typeof …Schema>` für seine Typen). Bei
 * Schema-Änderungen bricht der TypeScript-Compiler beidseitig — keine
 * stille Drift mehr.
 *
 * Zod 4: alle Schemas haben `.strict()` (keine unbekannten Felder),
 * Default-Werte sind absichtlich serverseitig — der Client kann sie
 * weglassen.
 */
import { z } from "zod";

/** KI-Sitz-Typ: random/heuristic/nn(-version). */
export const AiSeatTypeSchema = z
  .string()
  .regex(
    /^(random|heuristic|nn(-.+)?)$/,
    "aiSeatType must be 'random', 'heuristic', 'nn' or 'nn-<version>'"
  );

export const JoinModeSchema = z.enum(["OPEN", "REQUEST", "INVITE"]);
export type JoinMode = z.infer<typeof JoinModeSchema>;

export const RestartModeSchema = z.enum(["WELI", "SIEGER_GIBT"]);
export type RestartMode = z.infer<typeof RestartModeSchema>;

/** Spielarten: Kreuz-Jass (4er-Team, 4 Sitze), Solo-Jass (jeder gegen jeden,
 * 4 Sitze) und Bodensee-Jass (2 Spieler). KREUZ_6P / KREUZ_STEIGERN folgen. */
export const VariantEnumSchema = z.enum(["KREUZ_4P", "SOLO_4P", "BODENSEE_2P"]);
export type VariantEnum = z.infer<typeof VariantEnumSchema>;

/**
 * Erlaubte Ansage-Arten am Tisch (strikte Leiter, jede Stufe erweitert die
 * vorige): TRUMPF → GEISS_BOCK (+Oben/Unten) → SLALOM (+Slalom) → ALLES
 * (+Gumpf, Default). Siehe @jass/engine `AnnounceLevel` / `announceConstraints`.
 */
export const AnnounceLevelSchema = z.enum(["TRUMPF", "GEISS_BOCK", "SLALOM", "ALLES"]);
export type AnnounceLevel = z.infer<typeof AnnounceLevelSchema>;

/** Tisch-Lebenszyklus aus Sicht der Lobby. */
export const LobbyStatusSchema = z.enum([
  "WAITING",
  "IN_GAME",
  "POST_GAME",
  "MATCH_OVER",
  "CLOSED",
]);
export type LobbyStatus = z.infer<typeof LobbyStatusSchema>;

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
    /** Erlaubte Ansage-Arten. Default ALLES = alle Möglichkeiten aktiv. */
    announceLevel: AnnounceLevelSchema.default("ALLES"),
    /**
     * **„Sack"**: Wer pro Runde < 21 reine Kartenpunkte (aus Stichen) macht,
     * bekommt gar nichts gewertet — Kartenpunkte UND Weis verfallen (kein
     * Transfer ans andere Team). Default aus.
     */
    sackRule: z.boolean().default(false),
    /**
     * **„Kein Stich → Weis verfällt"**: Wer keinen einzigen Stich macht,
     * verliert am Rundenende seine Weis-Punkte wieder. Default aus.
     */
    weisNeedsTrick: z.boolean().default(false),
    /**
     * **Echtes Abheben**: vor jedem Geben (außer dem WELI-Deal in Spiel 1)
     * hebt der Spieler rechts vom Geber real ab — oder klopft. Default an
     * (Vorarlberger Tradition).
     */
    cutEnabled: z.boolean().default(true),
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
     * und 5000. Wenn der Eröffner kein eigenes `targetScore` mitgibt, greift
     * der globale Admin-Default (`LobbySettingsService.defaultPointsTarget`,
     * Fallback 1000) — verwendet im `LobbyService.openTable`.
     */
    targetScore: z.number().int().min(500).max(5000).optional(),
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
    status: z.union([LobbyStatusSchema, z.array(LobbyStatusSchema)]).optional(),
    joinMode: JoinModeSchema.optional(),
    mine: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .optional(),
  })
  .strict();
export type ListTablesQuery = z.infer<typeof ListTablesQuerySchema>;

// ─── Antwort-Shapes (read-only Server-Views) ─────────────────────────────
//
// Diese Schemas spiegeln die View-Builder im LobbyService (`buildListEntry`,
// `buildDetailView`). Sie sind hier definiert, damit das Frontend dieselbe
// Type-Definition bekommt — keine duplizierte handgepflegte Type-Datei.

export const TableListEntrySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  status: LobbyStatusSchema,
  joinMode: JoinModeSchema,
  variant: VariantEnumSchema,
  aiSeatType: z.string(),
  autoFillSeconds: z.number().int().nullable(),
  restartMode: RestartModeSchema,
  targetScore: z.number().int(),
  cumulativeScores: z.array(z.number().int()).readonly(),
  seatsTaken: z.number().int(),
  hasPendingRequest: z.boolean(),
  createdAt: z.string(), // ISO
});
export type TableListEntry = z.infer<typeof TableListEntrySchema>;

export const SeatViewSchema = z.object({
  seat: z.number().int(),
  user: z.object({ id: z.string(), name: z.string() }).optional(),
  aiSeatType: z.string().optional(),
  isEmpty: z.boolean(),
});
export type SeatView = z.infer<typeof SeatViewSchema>;

export const TableDetailViewSchema = TableListEntrySchema.extend({
  seats: z.array(SeatViewSchema),
  currentGameId: z.string().nullable(),
  joinRequests: z
    .array(
      z.object({
        id: z.string(),
        userId: z.string(),
        userName: z.string(),
        createdAt: z.string(),
      })
    )
    .optional(),
  invites: z
    .array(
      z.object({
        id: z.string(),
        inviteeUserId: z.string(),
        inviteeName: z.string(),
        createdAt: z.string(),
      })
    )
    .optional(),
});
export type TableDetailView = z.infer<typeof TableDetailViewSchema>;

export const JoinResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("seated"), seat: z.number().int() }),
  z.object({ kind: z.literal("request-pending"), requestId: z.string() }),
  z.object({ kind: z.literal("invite-used"), seat: z.number().int() }),
]);
export type JoinResult = z.infer<typeof JoinResultSchema>;
