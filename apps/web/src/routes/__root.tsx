/**
 * Root-Route. Header zeigt — abhängig vom Session-State — entweder
 * Login/Register-Buttons (anonym) oder Name + Logout (eingeloggt).
 *
 * Der `RouterContext` enthält den QueryClient (für `loader`-Hooks). Der
 * Auth-Status fragen wir hier direkt über `useSession()` ab; im
 * Sub-Layout `_auth.tsx` wird er als Guard verwendet.
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { ConsentBanner } from "~/features/consent/ConsentBanner";
import type { MeProfileResponse } from "~/features/admin/types";
import { api } from "~/lib/api";
import { signOut, useSession } from "~/lib/auth-client";
import { useTheme } from "~/lib/theme";
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
      <main className="flex-1 mx-auto max-w-5xl w-full px-4 py-6">
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

  const onInvite = useCallback(
    (payload: unknown) => {
      const p = payload as { tableId?: string; inviteId?: string };
      if (!p?.tableId) return;
      showToast(
        <span>
          Neue Einladung zum Tisch.{" "}
          <a href={`/table/${p.tableId}`} className="underline">
            Zum Tisch
          </a>
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
            Deine Anfrage wurde angenommen.{" "}
            {p.tableId && (
              <a href={`/table/${p.tableId}`} className="underline">
                Zum Tisch
              </a>
            )}
          </span>,
          { variant: "success", duration: 8_000 }
        );
      } else {
        showToast("Deine Anfrage wurde abgelehnt.", { variant: "warning" });
      }
    },
    [showToast]
  );

  const onOwnerChanged = useCallback(
    (payload: unknown) => {
      const p = payload as { newOwnerName?: string };
      showToast(
        `Tisch-Verwalter hat gewechselt zu ${p?.newOwnerName ?? "einem anderen Spieler"}.`,
        { variant: "info" }
      );
    },
    [showToast]
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
  const navigate = useNavigate();
  // DB-Rolle lädt nur, wenn eingeloggt — für den optionalen "Admin"-
  // Nav-Link. 401 (anonym) wird stillschweigend geschluckt.
  const { data: me } = useQuery<MeProfileResponse>({
    queryKey: ["users", "me"],
    queryFn: () => api<MeProfileResponse>("/api/users/me"),
    enabled: Boolean(data?.user),
    retry: false,
  });

  return (
    <header className="border-b-2 border-jass-paperEdge bg-jass-cream shadow-sm">
      <nav className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-6">
        <Link
          to="/"
          className="font-serif text-2xl font-semibold text-jass-ink hover:text-jass-brown transition-colors"
        >
          {t("appName")}
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <ContrastToggle />
          <LanguageSwitcher />
          {isPending ? (
            <span className="text-sm text-jass-inkSoft">…</span>
          ) : data?.user ? (
            <>
              {me?.role === "ADMIN" && (
                <Link
                  to="/admin"
                  className="rounded bg-jass-yellow px-2 py-1 text-xs font-semibold text-jass-ink hover:bg-jass-yellowDark hover:text-jass-cream transition-colors"
                >
                  Admin
                </Link>
              )}
              <Link
                to="/profile"
                className="text-sm font-medium text-jass-inkSoft hover:text-jass-ink transition-colors"
              >
                {t("nav.profile")}
              </Link>
              <span className="text-sm text-jass-inkSoft">
                {t("nav.greeting", { name: data.user.name }).replace(data.user.name, "")}
                <strong className="text-jass-ink">{data.user.name}</strong>
              </span>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  await navigate({ to: "/" });
                }}
                className="btn-jass-secondary text-sm"
              >
                {t("nav.signOut")}
              </button>
            </>
          ) : (
            <>
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
 * Toggle für High-Contrast-Theme. Persistiert in localStorage; greift
 * sofort ohne Reload. Kleines Button-Icon-Pair statt Switch, weil das
 * im a11y-Sinne klarer ist (visueller State sofort sichtbar).
 */
function ContrastToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const isHi = theme === "hi-contrast";
  return (
    <button
      type="button"
      onClick={() => setTheme(isHi ? "default" : "hi-contrast")}
      aria-pressed={isHi}
      aria-label={t(isHi ? "theme.toDefault" : "theme.toHiContrast")}
      title={t(isHi ? "theme.toDefault" : "theme.toHiContrast")}
      className="rounded border border-jass-paperEdge bg-jass-paper px-2 py-1 text-sm hover:bg-jass-cream text-jass-ink"
    >
      {isHi ? "🎨" : "◐"}
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
