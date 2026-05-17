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
}
