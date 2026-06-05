/**
 * Cookie-/Consent-Banner.
 *
 * **Was wir hier zeigen**:
 *   - Hinweis auf technisch notwendige Cookies (Better-Auth-Session,
 *     Consent-Flag). KEINE Tracking- oder Analytics-Cookies — daher
 *     auch keine „Ablehnen"-Konsequenz auf Funktionalität.
 *   - „OK, verstanden"-Button setzt das Consent-Flag in `localStorage`.
 *   - Link zur Datenschutzerklärung (auf der Landing-Seite).
 *
 * **Warum localStorage statt Cookie?** Das Consent-Flag selbst muss kein
 * Cookie sein — wir wollen ja gerade KEINE Cookies setzen, die nicht
 * notwendig sind. localStorage ist Same-Origin und überlebt
 * Browser-Restart, das reicht.
 *
 * **Hook `useHasConsent()`**: damit künftige Analytics-/Sentry-Integrationen
 * sich davorhängen können (Plan §9 #14: „Cookie-Banner blockiert Sentry
 * pre-consent").
 */
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

const STORAGE_KEY = "heb-ab.consent.v1";
type ConsentValue = "accepted" | null;

function readConsent(): ConsentValue {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "accepted" ? "accepted" : null;
  } catch {
    return null;
  }
}

function writeConsent(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "accepted");
    window.dispatchEvent(new Event("consent-changed"));
  } catch {
    /* Storage blockiert (Private-Browsing) — kein Drama, Banner kommt halt wieder */
  }
}

/**
 * Hook für andere Features, die auf das Consent-Flag reagieren sollen
 * (z.B. spätere Analytics-Bootstraps).
 */
export function useHasConsent(): boolean {
  const [consent, setConsent] = useState<ConsentValue>(() => readConsent());
  useEffect(() => {
    const onChange = (): void => setConsent(readConsent());
    window.addEventListener("storage", onChange);
    window.addEventListener("consent-changed", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("consent-changed", onChange);
    };
  }, []);
  return consent === "accepted";
}

export function ConsentBanner() {
  const { t } = useTranslation();
  const accepted = useHasConsent();
  if (accepted) return null;

  return (
    <div
      role="region"
      aria-label={t("consent.ariaLabel")}
      className="fixed inset-x-0 bottom-0 z-50 bg-stone-900 text-white shadow-lg"
    >
      <div className="mx-auto max-w-5xl px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-sm flex-1">
          <Trans
            i18nKey="consent.text"
            components={{
              strong: <strong />,
              privacy: (
                <a
                  href="/privacy"
                  className="underline hover:no-underline"
                  target="_blank"
                  rel="noreferrer"
                />
              ),
            }}
          />
        </p>
        <button
          type="button"
          onClick={() => writeConsent()}
          className="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium hover:bg-emerald-400"
        >
          {t("consent.accept")}
        </button>
      </div>
    </div>
  );
}
