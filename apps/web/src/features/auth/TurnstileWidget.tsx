/**
 * Cloudflare-Turnstile-Widget. Lädt das CF-Script lazy, rendert das
 * Widget in einen `<div>` mit `ref`, und feuert `onToken(token)`, sobald
 * der User die Challenge gelöst hat (oder Turnstile sie automatisch
 * lösen konnte).
 *
 * **Dev-Bypass**: Wenn `VITE_TURNSTILE_SITE_KEY` nicht gesetzt ist,
 * rendert das Widget gar nichts und ruft `onToken("dev-bypass")` einmal
 * synchron auf — damit der Submit-Button nicht ewig disabled bleibt.
 * Der Backend-Service ignoriert das Token sowieso, wenn auch dort kein
 * Secret konfiguriert ist.
 *
 * **Reset**: Wenn der Submit fehlschlägt (z.B. Passwort-Stärke), muss
 * der Token gelöscht werden, weil Turnstile-Tokens nur einmal einlösbar
 * sind. Caller ruft via `key={resetCounter}` neu — die Komponente
 * unmountet/remountet und holt sich ein frisches Token.
 */
import { useEffect, useRef } from "react";

interface TurnstileGlobal {
  render: (
    el: HTMLElement | string,
    options: {
      sitekey: string;
      callback?: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      action?: string;
      theme?: "light" | "dark" | "auto";
    }
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";

interface Props {
  /** Wird aufgerufen, sobald ein Token verfügbar ist. */
  onToken: (token: string) => void;
  /** Optionaler Action-Label für Cloudflare-Analytics (z.B. "register"). */
  action?: string;
}

export function TurnstileWidget({ onToken, action }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const siteKey = import.meta.env["VITE_TURNSTILE_SITE_KEY"] as string | undefined;

  useEffect(() => {
    // Dev-Bypass: ohne Site-Key kein Widget, ein Dummy-Token an Caller.
    if (!siteKey) {
      onToken("dev-bypass");
      return;
    }

    let cancelled = false;

    async function ensureScript(): Promise<void> {
      if (typeof window.turnstile !== "undefined") return;
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_URL}"]`);
        if (existing) {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("turnstile script")), {
            once: true,
          });
          return;
        }
        const s = document.createElement("script");
        s.src = `${SCRIPT_URL}?render=explicit`;
        s.async = true;
        s.defer = true;
        s.addEventListener("load", () => resolve(), { once: true });
        s.addEventListener("error", () => reject(new Error("turnstile script")), { once: true });
        document.head.appendChild(s);
      });
    }

    void (async () => {
      try {
        await ensureScript();
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onToken(token),
          // Error/Expired: leere Callbacks, damit Cloudflare nicht den
          // Default-DOM-Reset triggert. Caller ist für Re-Render via key
          // selbst verantwortlich.
          "error-callback": () => {
            /* noop */
          },
          "expired-callback": () => {
            /* noop */
          },
          ...(action ? { action } : {}),
          theme: "light",
        });
      } catch {
        // Wenn das Script nicht lädt (CF blockiert?): Token nie geliefert,
        // Submit bleibt disabled. Das ist Fail-Closed und gewollt.
      }
    })();

    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          // ignore
        }
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, action, onToken]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="my-2" />;
}
