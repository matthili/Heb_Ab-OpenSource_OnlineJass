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
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "~/lib/auth-client";
import { ApiError } from "~/lib/api";
import { ChatBubble } from "./ChatBubble";
import { useChat } from "./useChat";

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
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("chat.composerPlaceholder")}
          rows={2}
          maxLength={2000}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
          aria-label={t("chat.composerAria")}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-stone-400">
            <code>{t("chat.markdownHintBold")}</code> · <code>{t("chat.markdownHintItalic")}</code>{" "}
            · <code>{t("chat.markdownHintCode")}</code>
          </span>
          <button
            type="submit"
            disabled={isSending || draft.trim().length === 0}
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
