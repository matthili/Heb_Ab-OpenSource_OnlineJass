/**
 * Zod-DTOs für die Chat-Endpoints.
 *
 * `channelKey` ist die zentrale Adresse einer Konversation:
 *   - Lobby (global): `"lobby:global"`
 *   - Game (am Tisch): `"game:<gameId>"`
 *   - DM (Direktnachricht): `"dm:<userA>:<userB>"` — Reihenfolge der IDs
 *     ist immer aufsteigend (alphanumerisch), damit egal wer den ersten
 *     Pfeil schickt, beide auf demselben Kanal-Key landen.
 */
import { z } from "zod";

export const ChannelKeySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^(lobby:global|game:[a-z0-9_-]{1,128}|table:[a-z0-9_-]{1,128}|dm:[a-z0-9_-]{1,128}:[a-z0-9_-]{1,128})$/i,
    "channelKey must be 'lobby:global', 'game:<id>', 'table:<id>', or 'dm:<a>:<b>'"
  );

export const SendChatDtoSchema = z
  .object({
    channelKey: ChannelKeySchema,
    /**
     * Roh-Markdown vom Client. Server sanitized — was nicht auf die
     * Whitelist passt, wird stillschweigend entfernt. Max 2000 Zeichen,
     * damit niemand einen 100k-Buchstaben-Spam losbringt.
     */
    body: z.string().min(1).max(2000),
  })
  .strict();
export type SendChatDto = z.infer<typeof SendChatDtoSchema>;

export const ChatHistoryQuerySchema = z
  .object({
    channelKey: ChannelKeySchema,
    /** Optional: nur Messages vor diesem ISO-Timestamp (Pagination). */
    before: z.string().datetime().optional(),
    /** Limit 1..200, Default 50. */
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ChatHistoryQuery = z.infer<typeof ChatHistoryQuerySchema>;

/**
 * Helfer: zwei User-IDs in einen DM-Channel-Key bringen. Aufrufer
 * können beliebige Reihenfolge übergeben; der Key ist deterministisch
 * sortiert.
 */
export function makeDmChannelKey(userA: string, userB: string): string {
  const [a, b] = [userA, userB].sort();
  return `dm:${a}:${b}`;
}
