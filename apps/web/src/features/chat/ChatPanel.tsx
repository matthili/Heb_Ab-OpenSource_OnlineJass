/**
 * Chat-Panel: Header + scrollbare Messages + Composer.
 *
 * Wird in der Lobby (`channelKey="lobby:global"`) und im Tisch-Detail
 * (`channelKey="game:<gameId>"`) eingehängt. DM-Channels nutzen denselben
 * Component mit `channelKey="dm:<a>:<b>"` (UI-Einstieg dafür kommt mit
 * dem Friends-Feature in M10+).
 *
 * Composer:
 *   - Enter sendet, Shift+Enter macht Zeilenumbruch
 *   - Submit-Button für Touch-Devices
 *   - Markdown-Hint („**fett** *kursiv* `code`")
 */
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "~/lib/auth-client";
import { api, ApiError } from "~/lib/api";
import { ChatBubble } from "./ChatBubble";
import { EmojiPicker } from "./EmojiPicker";
import { useChat } from "./useChat";

/**
 * Bei einem DM-Kanal (`dm:<a>:<b>`) die Gegenseite (≠ ich) bestimmen — für die
 * Vorab-Prüfung der PN-Empfangsrechte. Nicht-DM-Kanäle liefern `null`.
 */
function dmRecipientId(channelKey: string, myUserId: string | undefined): string | null {
  if (!channelKey.startsWith("dm:") || !myUserId) return null;
  const [, a, b] = channelKey.split(":");
  if (!a || !b) return null;
  return a === myUserId ? b : a;
}

interface Props {
  channelKey: string;
  /** Anzeigetitel (z.B. "Lobby" / "Tisch-Chat" / "Mit @<name>"). */
  title: string;
  className?: string;
  /** Kopfzeile ausblenden (z.B. wenn ein DM-Fenster seinen eigenen Titel hat). */
  hideHeader?: boolean;
}

export function ChatPanel({ channelKey, title, className = "", hideHeader = false }: Props) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const myUserId = session?.user?.id;
  const { messages, isLoading, error, sendMessage, isSending, sendError } = useChat(channelKey);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Emoji an der Cursor-Position einfügen (Fallback: ans Ende anhängen).
  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => d + emoji);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  // PN-Empfangsrechte: Bei DM-Kanälen vorab prüfen, ob wir an die Gegenseite
  // schreiben dürfen (dmPolicy / DmBlock). Ist es verboten, sperren wir den
  // Composer und zeigen einen Hinweis — der Server würde sonst mit 403 ablehnen.
  const recipientId = dmRecipientId(channelKey, myUserId);
  const canDmQuery = useQuery({
    queryKey: ["chat", "can-dm", recipientId],
    queryFn: () =>
      api<{ allowed: boolean; reason: string | null }>(`/api/chat/can-dm/${recipientId}`),
    enabled: recipientId !== null,
    staleTime: 30_000,
  });
  const dmBlocked = recipientId !== null && canDmQuery.data?.allowed === false;

  // Auto-Scroll an's Ende, wenn neue Messages reinkommen.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    try {
      await sendMessage(trimmed);
      setDraft("");
    } catch {
      // Fehler wird via sendError unten angezeigt.
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void (e.currentTarget.form ?? e.currentTarget.closest("form"))?.requestSubmit();
    }
  }

  const sendErrMsg =
    sendError instanceof ApiError ? sendError.message : sendError ? t("chat.sendFailed") : null;

  return (
    <section className={`flex flex-col rounded border border-stone-200 bg-white ${className}`}>
      {!hideHeader && (
        <header className="px-3 py-2 border-b border-stone-200 text-sm font-medium text-stone-700">
          {title}
        </header>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-[12rem] max-h-[24rem]"
        aria-live="polite"
        aria-atomic="false"
      >
        {isLoading && <p className="text-sm text-stone-400">…</p>}
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error.message}
          </p>
        )}
        {!isLoading && !error && messages.length === 0 && (
          <p className="text-sm text-stone-400 italic">{t("chat.empty")}</p>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} isOwn={m.senderId === myUserId} />
        ))}
      </div>

      <form onSubmit={onSubmit} className="border-t border-stone-200 p-2 space-y-1">
        {dmBlocked && (
          <p role="status" className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">
            {t("chat.dmBlockedHint")}
          </p>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("chat.composerPlaceholder")}
          rows={2}
          maxLength={2000}
          disabled={dmBlocked}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-stone-100 disabled:text-stone-400"
          aria-label={t("chat.composerAria")}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <EmojiPicker onPick={insertEmoji} disabled={dmBlocked} />
            <span className="text-xs text-stone-400">
              <code>{t("chat.markdownHintBold")}</code> ·{" "}
              <code>{t("chat.markdownHintItalic")}</code> ·{" "}
              <code>{t("chat.markdownHintCode")}</code>
            </span>
          </div>
          <button
            type="submit"
            disabled={isSending || draft.trim().length === 0 || dmBlocked}
            className="rounded bg-stone-900 px-3 py-1 text-sm text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {isSending ? "…" : t("chat.send")}
          </button>
        </div>
        {sendErrMsg && (
          <p role="alert" className="text-xs text-rose-700">
            {sendErrMsg}
          </p>
        )}
      </form>
    </section>
  );
}
