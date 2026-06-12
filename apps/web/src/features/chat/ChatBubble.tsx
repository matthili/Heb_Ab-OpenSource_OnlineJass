/**
 * Eine einzelne Chat-Nachricht.
 *
 * **Defense-in-Depth**: Der Server liefert bereits sanitized HTML
 * (siehe `apps/api/src/modules/chat/chat.sanitize.ts`). Wir sanitizen
 * trotzdem nochmal auf Client-Seite mit DOMPurify, bevor wir per
 * `dangerouslySetInnerHTML` einfügen — Plan-Doc-Sicherheits-Checkliste
 * #6: „server-side double-sanitize".
 */
import DOMPurify from "dompurify";
import { useMemo } from "react";

import { UserName } from "~/features/social/UserName";
import type { ChatMessageView } from "./types";

const ALLOWED_TAGS = ["p", "strong", "em", "code", "a", "br"];
const ALLOWED_ATTR = ["href", "title", "target", "rel"];

interface Props {
  message: ChatMessageView;
  isOwn: boolean;
}

export function ChatBubble({ message, isOwn }: Props) {
  const safeHtml = useMemo(
    () =>
      DOMPurify.sanitize(message.body, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        KEEP_CONTENT: true,
      }),
    [message.body]
  );

  // System-Nachrichten (z.B. KI-Vote-Stimmen, Phasen-Hinweise vom
  // Disconnect-Flow) bekommen ein eigenes, dezenteres Rendering —
  // mittig, italic, keine „Bubble"-Form.
  if (message.system) {
    return (
      <div className="text-center text-xs italic text-stone-500 py-1 px-2">
        <span dangerouslySetInnerHTML={{ __html: safeHtml }} />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}
      data-message-id={message.id}
    >
      <div className="text-xs text-stone-500 mb-0.5 px-1">
        <UserName
          userId={message.senderId}
          name={message.senderName}
          className="font-semibold text-stone-600"
        />{" "}
        · {formatTime(message.createdAt)}
      </div>
      <div
        className={`rounded-lg px-3 py-1.5 text-sm max-w-[80%] ${
          isOwn ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-900"
        }`}
        // sanitized 2× (Server in chat.sanitize.ts, Client per useMemo oben)
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
