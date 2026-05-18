/**
 * `useAnimatedNumber` — interpoliert einen Zahlenwert weich von alt zu
 * neu über eine konfigurierbare Dauer. Wird vom Scoreboard genutzt, damit
 * die Team-Punkte sich nach einem Stich animiert hochzählen statt schlagartig
 * zu springen.
 *
 * Implementierung mit `requestAnimationFrame`: pro Frame der Browser den
 * Fortschritt 0..1 berechnen, mit ease-out-cubic glätten, runden, setzen.
 * Beim erneuten Target-Wechsel mitten in der Animation wird der aktuelle
 * Wert zum neuen Startpunkt und die Animation läuft weiter.
 *
 * **Respekt vor reduced-motion**: User mit OS-Flag bekommen direkt den
 * Zielwert, ohne Tweening.
 */
import { useEffect, useRef, useState } from "react";

export function useAnimatedNumber(target: number, durationMs: number = 700): number {
  const [displayed, setDisplayed] = useState<number>(target);
  const startValueRef = useRef<number>(target);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (displayed === target) return;

    // Wenn der User animationen abgeschaltet hat: direkt setzen, kein Tween.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplayed(target);
      return;
    }

    startValueRef.current = displayed;
    startTimeRef.current = performance.now();

    const tick = (): void => {
      const elapsed = performance.now() - startTimeRef.current;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
      const value = Math.round(startValueRef.current + (target - startValueRef.current) * eased);
      setDisplayed(value);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // displayed bewusst NICHT als dep — sonst entstehen Endlosschleifen.
  }, [target, durationMs]);

  return displayed;
}
