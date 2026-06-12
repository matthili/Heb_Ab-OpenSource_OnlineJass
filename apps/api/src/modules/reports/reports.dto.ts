import { z } from "zod";

export const ReportContextSchema = z.enum(["PROFILE", "CHAT", "GAME"]);
export const ReportReasonSchema = z.enum([
  "RACISM",
  "SEXISM",
  "HARASSMENT",
  "THREATS",
  "VIOLENCE",
  "SPAM",
  "OTHER_ILLEGAL",
  "GAME_DISRUPTION",
]);
export const ReportStatusSchema = z.enum(["PENDING", "REVIEWED", "DISMISSED", "ACTION_TAKEN"]);
export type ReportStatusValue = z.infer<typeof ReportStatusSchema>;

/** User meldet einen anderen: wo (`context`) + warum (`reason`) + optional Freitext. */
export const ReportUserDtoSchema = z
  .object({
    context: ReportContextSchema,
    reason: ReportReasonSchema,
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ReportUserDto = z.infer<typeof ReportUserDtoSchema>;

export const ListReportsQuerySchema = z
  .object({
    status: ReportStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListReportsQuery = z.infer<typeof ListReportsQuerySchema>;

export const SetReportStatusDtoSchema = z.object({ status: ReportStatusSchema }).strict();
export type SetReportStatusDto = z.infer<typeof SetReportStatusDtoSchema>;
