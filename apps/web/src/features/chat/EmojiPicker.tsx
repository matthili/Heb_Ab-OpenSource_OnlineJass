/**
 * Kleiner Emoji-Picker fürs Chat-/DM-Eingabefeld.
 *
 * Bewusst KEIN großes Emoji-Paket (Bundle-Gewicht, Picker-Abhängigkeit) —
 * ein kuratiertes Set deckt die typischen Chat-Reaktionen + ein paar
 * Jass-/Karten-Motive ab. `onPick` fügt das Unicode-Zeichen ein; das
 * Einfügen an der Cursor-Position übernimmt der Aufrufer.
 *
 * Schließt bei Klick außerhalb / Escape (Muster wie `UserContextMenu`).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Kuratiertes Set: Reaktionen, Gesten, Karten-/Jass-Motive. */
const EMOJIS = [
  "😀",
  "😄",
  "😉",
  "😎",
  "😅",
  "😂",
  "🤣",
  "🙂",
  "😊",
  "😇",
  "🤔",
  "😐",
  "😴",
  "😮",
  "😢",
  "😭",
  "😡",
  "🤯",
  "🥳",
  "😬",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🙏",
  "💪",
  "🤝",
  "👋",
  "✌️",
  "🤞",
  "❤️",
  "🔥",
  "✨",
  "⭐",
  "🎉",
  "🎲",
  "🃏",
  "♥️",
  "♦️",
  "♣️",
  "♠️",
  "💰",
  "🏆",
  "⏱️",
  "☕",
  "🍻",
  "👀",
  "💬",
  "❓",
  "❗",
];

export function EmojiPicker({
  onPick,
  disabled = false,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label={t("chat.emoji.label")}
        aria-expanded={open}
        className="rounded px-2 py-1 text-base leading-none hover:bg-stone-100 disabled:opacity-50"
      >
        🙂
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("chat.emoji.label")}
          className="absolute bottom-full left-0 z-20 mb-1 grid w-56 grid-cols-10 gap-0.5 rounded border border-stone-200 bg-white p-1.5 shadow-lg"
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              className="rounded p-0.5 text-base leading-none hover:bg-amber-100"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
