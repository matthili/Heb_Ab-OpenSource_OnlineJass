/**
 * Frontend-Types für Chat (gespiegelt vom Backend
 * `apps/api/src/modules/chat/chat.service.ts`).
 */
export type ChatChannel = "LOBBY" | "GAME" | "DM";

export interface ChatMessageView {
  id: string;
  channel: ChatChannel;
  channelKey: string;
  senderId: string;
  senderName: string;
  body: string; // server-sanitized HTML
  createdAt: string; // ISO
  /**
   * Ephemere System-Nachricht (z.B. KI-Vote-Stimmen aus dem Disconnect-
   * Flow). Server-Marker — wenn true, wird die Nachricht im UI anders
   * gerendert (Italic, ausgegraut) und nicht persistiert.
   */
  system?: boolean;
}
