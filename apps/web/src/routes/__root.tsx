/**
 * Root-Route. Header zeigt — abhängig vom Session-State — entweder
 * Login/Register-Buttons (anonym) oder Name + Logout (eingeloggt).
 *
 * Der `RouterContext` enthält den QueryClient (für `loader`-Hooks). Der
 * Auth-Status fragen wir hier direkt über `useSession()` ab; im
 * Sub-Layout `_auth.tsx` wird er als Guard verwendet.
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";

import { ConsentBanner } from "~/features/consent/ConsentBanner";
import { BrandLogo } from "~/features/brand/BrandLogo";
import { SignOutMenu } from "~/features/auth/SignOutMenu";
import type { MeProfileResponse } from "~/features/admin/types";
import { AfkButton } from "~/lib/afk";
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
  const queryClient = useQueryClient();

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

  // Eingehende Freundschaftsanfrage: Toast + Live-Refresh der Freunde-Queries,
  // damit Freunde-Tab und Kontextmenü sofort den neuen Stand zeigen.
  const onFriendRequest = useCallback(
    (payload: unknown) => {
      const p = payload as { fromId?: string; fromName?: string };
      void queryClient.invalidateQueries({ queryKey: ["friends"] });
      if (p?.fromId) {
        void queryClient.invalidateQueries({ queryKey: ["friends", "status", p.fromId] });
      }
      showToast(
        <span>
          <Trans
            i18nKey="nav.toasts.friendRequestReceived"
            values={{ name: p?.fromName ?? "" }}
            components={{ link: <a href="/profile?tab=friends" className="underline" /> }}
          />
        </span>,
        { variant: "info", duration: 8_000 }
      );
    },
    [showToast, queryClient]
  );

  // Eine von mir gesendete Anfrage wurde angenommen.
  const onFriendAccepted = useCallback(
    (payload: unknown) => {
      const p = payload as { fromId?: string; fromName?: string };
      void queryClient.invalidateQueries({ queryKey: ["friends"] });
      if (p?.fromId) {
        void queryClient.invalidateQueries({ queryKey: ["friends", "status", p.fromId] });
      }
      showToast(t("nav.toasts.friendRequestAccepted", { name: p?.fromName ?? "" }), {
        variant: "success",
        duration: 8_000,
      });
    },
    [showToast, t, queryClient]
  );

  // Neue Beitritts-Anfrage an meinen Tisch (nur der Owner bekommt das Event):
  // global als Toast melden — egal auf welcher Seite man gerade ist. Auf der
  // Tisch-Seite aktualisiert TableDetail zusätzlich die Anfragen-Liste.
  const onJoinRequest = useCallback(
    (payload: unknown) => {
      const p = payload as { tableId?: string; userName?: string };
      if (!p?.tableId) return;
      showToast(
        <span>
          <Trans
            i18nKey="nav.toasts.joinRequestIncoming"
            values={{ name: p.userName ?? "" }}
            components={{ link: <a href={`/table/${p.tableId}`} className="underline" /> }}
          />
        </span>,
        { variant: "info", duration: 8_000 }
      );
    },
    [showToast]
  );

  // Wir registrieren die Listener immer; sie feuern nur, wenn man
  // eingeloggt ist (lobby:user:<id>-Room ist sonst nicht gejoint).
  useUserEvents("lobby:invite-received", onInvite);
  useUserEvents("lobby:request-decided", onRequestDecided);
  useUserEvents("lobby:owner-changed", onOwnerChanged);
  useUserEvents("lobby:join-request-incoming", onJoinRequest);
  useUserEvents("friend:request-received", onFriendRequest);
  useUserEvents("friend:request-accepted", onFriendAccepted);

  return data?.user ? null : null;
}

// ── Header-Nav-Link-Stil ────────────────────────────────────────────────
// Gemeinsamer Stil der Text-Nav-Links (Profil/Rangliste/Anmelden). Der
// AKTIVE Link bekommt volle Tinte + goldene Unterstreichung → man sieht auf
// einen Blick, auf welcher Seite man ist (Veronika-Feedback G1). TanStack-
// Router hängt `activeProps`/`inactiveProps`-className an die Basis an, daher
// trägt die Basis nur die gemeinsamen Teile.
const NAV_LINK_BASE = "text-sm font-medium transition-colors";
const NAV_LINK_ACTIVE = {
  className:
    "text-jass-ink font-semibold underline decoration-2 decoration-jass-yellow underline-offset-[6px]",
};
const NAV_LINK_INACTIVE = { className: "text-jass-inkSoft hover:text-jass-ink" };

function Header() {
  const { t, i18n } = useTranslation();
  const { data, isPending } = useSession();
  // Jass-Schule liegt in der Landing-App (/rules, /en/rules). In Production
  // same-origin; im lokalen Dev läuft die Landing als eigener Astro-Server
  // (Port 4321). Neuer Tab → das Spiel bleibt offen + verbunden (kein AFK,
  // da AFK manuell ist und kein Tab-Wechsel-Trigger existiert).
  const schoolHref = `${import.meta.env.DEV ? "http://localhost:4321" : ""}${
    i18n.language.startsWith("en") ? "/en/rules" : "/rules"
  }`;
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
            // Reihenfolge (Veronika B3): [Admin] · Servus · AFK · Profil ·
            // Rangliste · Jass-Schule · Farbmodus · Sprache · Abmelden.
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
                <Trans
                  i18nKey="nav.greeting"
                  values={{ name: data.user.name }}
                  components={{ strong: <strong className="text-jass-ink" /> }}
                />
              </span>
              <AfkButton />
              <Link
                to="/profile"
                className={NAV_LINK_BASE}
                activeProps={NAV_LINK_ACTIVE}
                inactiveProps={NAV_LINK_INACTIVE}
              >
                {t("nav.profile")}
              </Link>
              <Link
                to="/leaderboard"
                className={NAV_LINK_BASE}
                activeProps={NAV_LINK_ACTIVE}
                inactiveProps={NAV_LINK_INACTIVE}
              >
                {t("nav.leaderboard")}
              </Link>
              {/* Jass-Schule liegt in der Landing-App → externer Link, neuer
                  Tab, kein SPA-Aktiv-Zustand. */}
              <a
                href={schoolHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`${NAV_LINK_BASE} text-jass-inkSoft hover:text-jass-ink`}
              >
                {t("nav.school")}
              </a>
              <ContrastToggle />
              <LanguageSwitcher />
              <SignOutMenu />
            </>
          ) : (
            <>
              <a
                href={schoolHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`${NAV_LINK_BASE} text-jass-inkSoft hover:text-jass-ink`}
              >
                {t("nav.school")}
              </a>
              <ContrastToggle />
              <LanguageSwitcher />
              <Link
                to="/login"
                className={NAV_LINK_BASE}
                activeProps={NAV_LINK_ACTIVE}
                inactiveProps={NAV_LINK_INACTIVE}
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
      // Feste Quadrat-Größe (Veronika B1): das Icon wechselt je Theme (◐/🌙/🎨)
      // und die Emoji-Glyphen sind verschieden breit — eine fixe h-9 w-9-Box
      // hält den Button konstant groß. Optik = Landing-Theme-Toggle.
      className="inline-flex h-9 w-9 items-center justify-center rounded border border-jass-paperEdge bg-jass-paper text-sm leading-none text-jass-ink transition-colors hover:bg-jass-cream"
    >
      {THEME_ICON[theme]}
    </button>
  );
}

/**
 * Sprach-Umschalter — ein Toggle-Knopf wie auf der Landing-Page (Veronika B2),
 * kein Dropdown mehr. Beschriftung = Zielsprache ("EN" auf Deutsch, "DE" auf
 * Englisch), Tooltip in der Zielsprache. Klick wechselt direkt zwischen de↔en.
 */
function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const isEn = (i18n.resolvedLanguage ?? i18n.language).startsWith("en");
  const target = isEn ? "de" : "en";
  const label = isEn ? "DE" : "EN";
  const title = isEn ? "Auf Deutsch wechseln" : "Switch to English";
  return (
    <button
      type="button"
      onClick={() => void i18n.changeLanguage(target)}
      aria-label={title}
      title={title}
      className="inline-flex h-9 items-center rounded border border-jass-paperEdge bg-jass-paper px-2.5 text-sm font-semibold tracking-wide text-jass-ink transition-colors hover:bg-jass-cream"
    >
      {label}
    </button>
  );
}
