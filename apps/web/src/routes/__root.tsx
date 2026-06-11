/**
 * Root-Route. Header zeigt — abhängig vom Session-State — entweder
 * Login/Register-Buttons (anonym) oder Name + Logout (eingeloggt).
 *
 * Der `RouterContext` enthält den QueryClient (für `loader`-Hooks). Der
 * Auth-Status fragen wir hier direkt über `useSession()` ab; im
 * Sub-Layout `_auth.tsx` wird er als Guard verwendet.
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";

import { ConsentBanner } from "~/features/consent/ConsentBanner";
import { BrandLogo } from "~/features/brand/BrandLogo";
import { SignOutMenu } from "~/features/auth/SignOutMenu";
import type { MeProfileResponse } from "~/features/admin/types";
import { api } from "~/lib/api";
import { useSession } from "~/lib/auth-client";
import { type Theme, useTheme } from "~/lib/theme";
import { useToast } from "~/lib/toast";
import { useUserEvents } from "~/lib/ws";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <UserEventToasts />
      <Header />
      {/* sm:pt-11 = ~20 px mehr Abstand oben, damit der über die Header-
          Linie hängende Logo-Überhang nicht die erste Überschrift berührt
          (gilt für alle Seiten, da Layout geteilt). */}
      <main className="flex-1 mx-auto max-w-5xl w-full px-4 py-6 sm:pt-11">
        <Outlet />
      </main>
      <ConsentBanner />
    </div>
  );
}

/**
 * Subscribed nach User-Channel-Events (Invites, Anfrage-Entscheidungen,
 * Owner-Wechsel) und zeigt sie als Toasts. Nur als eingeloggter User
 * aktiv — sonst gibts keinen User-Channel.
 */
function UserEventToasts() {
  const { data } = useSession();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const onInvite = useCallback(
    (payload: unknown) => {
      const p = payload as { tableId?: string; inviteId?: string };
      if (!p?.tableId) return;
      showToast(
        <span>
          <Trans
            i18nKey="nav.toasts.inviteReceived"
            components={{ link: <a href={`/table/${p.tableId}`} className="underline" /> }}
          />
        </span>,
        { variant: "info", duration: 8_000 }
      );
    },
    [showToast]
  );

  const onRequestDecided = useCallback(
    (payload: unknown) => {
      const p = payload as { approved?: boolean; tableId?: string };
      if (p?.approved) {
        showToast(
          <span>
            {p.tableId ? (
              <Trans
                i18nKey="nav.toasts.requestApproved"
                components={{ link: <a href={`/table/${p.tableId}`} className="underline" /> }}
              />
            ) : (
              t("nav.toasts.requestApprovedNoLink")
            )}
          </span>,
          { variant: "success", duration: 8_000 }
        );
      } else {
        showToast(t("nav.toasts.requestDenied"), { variant: "warning" });
      }
    },
    [showToast, t]
  );

  const onOwnerChanged = useCallback(
    (payload: unknown) => {
      const p = payload as { newOwnerName?: string };
      showToast(
        t("nav.toasts.ownerChanged", {
          name: p?.newOwnerName ?? t("nav.toasts.ownerChangedFallback"),
        }),
        { variant: "info" }
      );
    },
    [showToast, t]
  );

  // Wir registrieren die Listener immer; sie feuern nur, wenn man
  // eingeloggt ist (lobby:user:<id>-Room ist sonst nicht gejoint).
  useUserEvents("lobby:invite-received", onInvite);
  useUserEvents("lobby:request-decided", onRequestDecided);
  useUserEvents("lobby:owner-changed", onOwnerChanged);

  return data?.user ? null : null;
}

function Header() {
  const { t } = useTranslation();
  const { data, isPending } = useSession();
  // DB-Rolle lädt nur, wenn eingeloggt — für den optionalen "Admin"-
  // Nav-Link. 401 (anonym) wird stillschweigend geschluckt.
  const { data: me } = useQuery<MeProfileResponse>({
    queryKey: ["users", "me"],
    queryFn: () => api<MeProfileResponse>("/api/users/me"),
    enabled: Boolean(data?.user),
    retry: false,
  });

  return (
    <header className="relative z-20 border-b-2 border-jass-paperEdge bg-jass-cream shadow-sm">
      {/* Feste, schlanke Bar-Höhe (h-16). Das Logo ist oben ausgerichtet
          (self-start) und auf sm+ höher als die Bar → es hängt unten über die
          Trennlinie in den Inhalt, ohne die Bar selbst zu vergrößern. z-20 +
          overflow-visible (Default) halten es über dem Seiteninhalt sichtbar. */}
      <nav className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4">
        <Link
          to="/"
          aria-label={t("appName")}
          className="shrink-0 self-start transition-opacity hover:opacity-80"
        >
          <BrandLogo variant="horizontal" alt={t("appName")} className="h-16 w-auto sm:h-24" />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {isPending ? (
            <span className="text-sm text-jass-inkSoft">…</span>
          ) : data?.user ? (
            // Reihenfolge: [Admin], Begrüßung, Profil, Farbmodus, Sprache, Abmelden
            <>
              {me?.role === "ADMIN" && (
                <Link
                  to="/admin"
                  className="rounded bg-jass-yellow px-2 py-1 text-xs font-semibold text-jass-ink hover:bg-jass-yellowDark hover:text-jass-cream transition-colors"
                >
                  {t("nav.admin")}
                </Link>
              )}
              <span className="text-sm text-jass-inkSoft">
                {t("nav.greeting", { name: data.user.name }).replace(data.user.name, "")}
                <strong className="text-jass-ink">{data.user.name}</strong>
              </span>
              <Link
                to="/profile"
                className="text-sm font-medium text-jass-inkSoft hover:text-jass-ink transition-colors"
              >
                {t("nav.profile")}
              </Link>
              <ContrastToggle />
              <LanguageSwitcher />
              <SignOutMenu />
            </>
          ) : (
            <>
              <ContrastToggle />
              <LanguageSwitcher />
              <Link
                to="/login"
                className="text-sm font-medium text-jass-inkSoft hover:text-jass-ink transition-colors"
              >
                {t("nav.signIn")}
              </Link>
              <Link to="/register" className="btn-jass-primary text-sm">
                {t("nav.signUp")}
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

/**
 * Theme-Umschalter — zyklisch: Hell → Dunkel → Hoher Kontrast → Hell.
 * Persistiert in localStorage; greift sofort ohne Reload. Icon zeigt das
 * AKTUELLE Theme, das aria-label/title beschreibt die NÄCHSTE Aktion
 * (a11y-Sinn: was passiert beim Klick).
 */
const THEME_NEXT: Record<Theme, Theme> = {
  default: "dark",
  dark: "hi-contrast",
  "hi-contrast": "default",
};
const THEME_ICON: Record<Theme, string> = {
  default: "◐",
  dark: "🌙",
  "hi-contrast": "🎨",
};
/** Label beschreibt die Aktion (= Wechsel zum jeweils nächsten Theme). */
const THEME_NEXT_LABEL: Record<Theme, string> = {
  default: "theme.toDark",
  dark: "theme.toHiContrast",
  "hi-contrast": "theme.toDefault",
};

function ContrastToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const label = t(THEME_NEXT_LABEL[theme]);
  return (
    <button
      type="button"
      onClick={() => setTheme(THEME_NEXT[theme])}
      aria-label={label}
      title={label}
      className="rounded border border-jass-paperEdge bg-jass-paper px-2 py-1 text-sm hover:bg-jass-cream text-jass-ink"
    >
      {THEME_ICON[theme]}
    </button>
  );
}

function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;
  return (
    <label className="text-sm flex items-center gap-1">
      <span className="sr-only">{t("language.label")}</span>
      <select
        value={current}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className="rounded border border-stone-300 px-2 py-1 text-sm bg-white"
        aria-label={t("language.label")}
      >
        <option value="de">{t("language.de")}</option>
        <option value="en">{t("language.en")}</option>
      </select>
    </label>
  );
}
