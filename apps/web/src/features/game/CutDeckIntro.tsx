/**
 * **CutDeckIntro** — Cinematic-Overlay vor dem ersten Hand-Reveal.
 *
 * In Vorarlberg gehört „Abheben" (Deck cutten) zum Spielritual: vor jedem
 * Geben hebt der Spieler rechts vom Geber einen Teil des Stapels ab und
 * legt ihn unter den Rest. Im Online-Spiel hat das keinen funktionalen
 * Effekt — der Server mischt schon kryptographisch — aber das Ritual
 * gehört dazu.
 *
 * Komponente:
 *   - Zeigt zentral einen Kartenstapel.
 *   - Oberer Halbstapel hebt sich, dreht leicht, fällt nach unten.
 *   - Insgesamt 2.6s, dann fadet sich raus.
 *   - **Einmal pro gameId**: localStorage merkt sich, welche gameIds bereits
 *     gesehen wurden, damit beim Tab-Reload oder Rematch kein Wiederholungs-
 *     Overlay nervt.
 *   - Prefers-reduced-motion: kein Render (CSS-Animation greift sowieso
 *     nicht, aber wir sparen den Overlay komplett).
 *
 * Layout: `absolute inset-0` — daher braucht der Parent `relative` /
 * Stacking-Context. Pointer-events sind `none`, sodass Inputs darunter
 * (theoretisch) durchklickbar bleiben — wir blockieren UI während der
 * Animation aber nicht zusätzlich. Der announcing-Dialog rendert
 * ohnehin erst nach dem Fade-Out durch (siehe `usedRef`-Trick).
 */
import { useEffect, useState } from "react";

const SEEN_KEY = "jass:cut-deck-seen";
const ANIM_MS = 2600;

interface Props {
  gameId: string;
  /** Wird gerufen, wenn die Animation abgeschlossen ist (Overlay unmounted). */
  onDone?: () => void;
}

/**
 * Hilfs-Funktion: liest die Liste gesehener gameIds aus localStorage.
 * Wir bauen einen kleinen Rotating-Buffer (max 50 Einträge), damit
 * localStorage nicht über Monate wächst.
 */
function loadSeen(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function markSeen(gameId: string): void {
  if (typeof window === "undefined") return;
  try {
    const seen = loadSeen();
    if (seen.includes(gameId)) return;
    const next = [gameId, ...seen].slice(0, 50);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    /* localStorage gesperrt → no-op */
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function CutDeckIntro({ gameId, onDone }: Props) {
  const [visible, setVisible] = useState<boolean>(() => {
    if (prefersReducedMotion()) return false;
    const seen = loadSeen();
    return !seen.includes(gameId);
  });

  useEffect(() => {
    if (!visible) return;
    markSeen(gameId);
    const t = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, ANIM_MS);
    return () => clearTimeout(t);
  }, [visible, gameId, onDone]);

  if (!visible) return null;

  return (
    <div
      role="presentation"
      aria-hidden="true"
      className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center"
    >
      <div className="jass-cut-stack">
        <div className="jass-cut-top" />
        <div className="jass-cut-bottom" />
      </div>
      <div className="jass-cut-label">Heb ab! ✋</div>
    </div>
  );
}
