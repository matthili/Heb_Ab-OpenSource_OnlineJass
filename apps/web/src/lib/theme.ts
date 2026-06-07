/**
 * Theme-Verwaltung — Default (hell) + Dark + High-Contrast.
 *
 * **Persistenz**: localStorage-Key `jass-theme`, Werte `"default"` |
 * `"dark"` | `"hi-contrast"`. `"default"` löscht den Key + das
 * data-theme-Attribut; die anderen setzen `data-theme="<wert>"` auf
 * <html>, worauf die CSS-Variablen-Overrides in styles.css greifen.
 * Server-Seite kennt das Theme nicht (rein clientside);
 * SSR wäre ein Hydration-Flash-Risiko, aber wir haben keine SSR.
 *
 * **Frühe Application**: das Theme muss VOR dem ersten React-Render
 * gesetzt werden, sonst flackert die Seite kurz im Default-Theme,
 * bevor das Hi-Contrast greift. Dafür gibt es `applyThemeFromStorage()`,
 * das in `main.tsx` direkt nach DOM-Ready aufgerufen wird.
 *
 * **Reduced-Motion**: ist via `prefers-reduced-motion` CSS-Media-Query
 * abgedeckt (siehe styles.css). Kein eigener Toggle nötig.
 */
import { useEffect, useState } from "react";

export type Theme = "default" | "dark" | "hi-contrast";

const STORAGE_KEY = "jass-theme";

/**
 * Liest das gespeicherte Theme. Fällt auf "default" zurück, wenn
 * localStorage nicht erreichbar ist (Private-Browsing-Edge-Case).
 */
export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "hi-contrast" || raw === "dark" ? raw : "default";
  } catch {
    return "default";
  }
}

/**
 * Schreibt das Theme + setzt das data-theme-Attribut auf <html>.
 * Tailwind-Komponenten lesen die CSS-Variablen-Overrides aus
 * styles.css automatisch (siehe :root[data-theme="hi-contrast"]).
 */
export function applyTheme(theme: Theme): void {
  try {
    if (theme === "default") {
      localStorage.removeItem(STORAGE_KEY);
      document.documentElement.removeAttribute("data-theme");
    } else {
      localStorage.setItem(STORAGE_KEY, theme);
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    // localStorage blockiert (Privacy-Modus) — DOM-Attribut setzen wir
    // trotzdem, dann wirkt das Theme zumindest für diese Session.
    if (theme === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }
}

/**
 * Beim Boot vor dem ersten Render aufrufen (in `main.tsx`). Ohne
 * diesen Schritt sehen User mit Hi-Contrast-Preference erst kurz
 * den Default-Look, bevor React den Theme-State setzt.
 */
export function applyThemeFromStorage(): void {
  applyTheme(loadTheme());
}

/**
 * React-Hook für Komponenten, die das Theme ändern wollen
 * (z.B. der Toggle-Button im Header).
 */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => loadTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme: setThemeState };
}
