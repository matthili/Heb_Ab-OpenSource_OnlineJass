/**
 * Visuelle Ansage-Anzeige (geteilt Kreuz/Solo + Bodensee):
 *
 *   - `AnnounceOverlay` — transientes Vollbild-Overlay (3 s, einmal pro
 *     gameId), das nach dem Festlegen der Ansage groß zeigt, was gilt
 *     (Icon + Titel + ggf. Erläuterung). Klick schließt sofort.
 *   - `ModeWatermark` — dauerhaftes, halbtransparentes Symbol in der
 *     Spielfeld-Mitte, damit man jederzeit sieht, was angesagt ist, ohne
 *     oben die kleine Modus-Zeile zu suchen.
 *
 * Beide bekommen die STABILE Ansage (`AnnounceModeInfo`) und rendern sich
 * `absolute inset-0` in einen `relative`-Container (das Spielfeld bzw. den
 * Bodensee-Tisch).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { announceDisplay, type AnnounceModeInfo } from "./announceDisplay";

const SEEN_KEY = "jass:announce-overlay-seen";

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function markSeen(gameId: string): void {
  if (typeof window === "undefined") return;
  try {
    const seen = loadSeen();
    if (seen.has(gameId)) return;
    seen.add(gameId);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-50)));
  } catch {
    /* localStorage gesperrt → no-op */
  }
}

/**
 * Transientes Overlay nach dem Ansagen. Zeigt sich genau einmal pro gameId
 * (localStorage-gemerkt, damit ein Reload es nicht erneut triggert) für 3 s.
 */
export function AnnounceOverlay({ gameId, info }: { gameId: string; info: AnnounceModeInfo }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (loadSeen().has(gameId)) return;
    markSeen(gameId);
    setVisible(true);
    const tmr = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(tmr);
  }, [gameId]);

  if (!visible) return null;
  const d = announceDisplay(t, info);
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={() => setVisible(false)}
      className="absolute inset-0 z-40 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg bg-black/55 px-6 text-center backdrop-blur-sm"
    >
      {d.iconSrc ? (
        <img
          src={d.iconSrc}
          alt=""
          draggable={false}
          className="h-28 w-28 object-contain drop-shadow-lg"
        />
      ) : (
        <span className="text-7xl font-black text-jass-yellow drop-shadow-lg">{d.glyph}</span>
      )}
      <div className="text-2xl font-bold text-white drop-shadow">{d.title}</div>
      {d.subtitle && <div className="max-w-sm text-sm text-stone-200">{d.subtitle}</div>}
    </div>
  );
}

/**
 * Dauerhaftes Modus-Wasserzeichen. Gehört HINTER den Stich (Container muss
 * `relative` sein, der Stich `z-10`); dieses Element bleibt auf `z-0`.
 */
export function ModeWatermark({ info }: { info: AnnounceModeInfo }) {
  const { t } = useTranslation();
  const d = announceDisplay(t, info);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
    >
      {d.iconSrc ? (
        <img
          src={d.iconSrc}
          alt=""
          draggable={false}
          className="h-48 w-48 object-contain opacity-[0.13]"
        />
      ) : (
        <span className="text-[10rem] font-black leading-none text-jass-ink opacity-[0.10]">
          {d.glyph}
        </span>
      )}
    </div>
  );
}
