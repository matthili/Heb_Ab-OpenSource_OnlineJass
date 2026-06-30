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
  /**
   * Höhe füllen statt fixe 24rem: der Nachrichten-Bereich wächst mit der
   * Spalte (im Spiel neben dem Brett, das — v.a. bei Bodensee — höher als
   * 24rem werden kann). Braucht eine Eltern-Spalte mit Höhe + `className`
   * mit `flex-1`.
   */
  fillHeight?: boolean;
}

export function ChatPanel({
  channelKey,
  title,
  className = "",
  hideHeader = false,
  fillHeight = false,
}: Props) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const myUserId = session?.user?.id;
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    isSending,
    sendError,
    loadOlder,
    isLoadingOlder,
    canLoadOlder,
  } = useChat(channelKey);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Für die Scroll-Logik: ob die letzte Änderung ein Prepend (Ältere laden)
  // war — dann NICHT ans Ende springen.
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLenRef = useRef(0);

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

  // Auto-Scroll ans Ende beim Erst-Laden und bei NEUEN (unten angehängten)
  // Nachrichten — aber NICHT beim Laden älterer (oben eingefügter): dort würde
  // es den Leser nach unten reißen. Prepend erkennen wir daran, dass die erste
  // Nachricht eine andere wurde, obwohl die Liste wuchs.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = messages[0]?.id ?? null;
    const prepended =
      messages.length > prevLenRef.current &&
      prevLenRef.current > 0 &&
      firstId !== prevFirstIdRef.current;
    prevFirstIdRef.current = firstId;
    prevLenRef.current = messages.length;
    if (!prepended) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // „Ältere laden": Inhalt wächst oben → Scroll-Position nachführen, damit die
  // gerade gelesene Stelle stehen bleibt (statt nach oben wegzuspringen).
  async function handleLoadOlder() {
    const el = scrollRef.current;
    const before = el?.scrollHeight ?? 0;
    await loadOlder();
    requestAnimationFrame(() => {
      const el2 = scrollRef.current;
      if (el2) el2.scrollTop += el2.scrollHeight - before;
    });
  }

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
    <section
      className={`flex flex-col rounded border border-stone-200 bg-white panel-jass ${className}`}
    >
      {!hideHeader && (
        <header className="px-3 py-2 border-b border-stone-200 text-sm font-medium text-stone-700">
          {title}
        </header>
      )}

      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-3 py-2 space-y-2 ${
          fillHeight ? "min-h-[20rem]" : "h-[24rem] max-h-[24rem]"
        }`}
        aria-live="polite"
        aria-atomic="false"
      >
        {canLoadOlder && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => void handleLoadOlder()}
              disabled={isLoadingOlder}
              className="text-xs text-stone-500 hover:text-stone-800 disabled:opacity-50"
            >
              {isLoadingOlder ? "…" : t("chat.loadOlder")}
            </button>
          </div>
        )}
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
            className="btn-jass-primary text-sm"
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
