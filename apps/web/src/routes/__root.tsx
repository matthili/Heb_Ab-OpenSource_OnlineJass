/**
 * Root-Route. Header zeigt — abhängig vom Session-State — entweder
 * Login/Register-Buttons (anonym) oder Name + Logout (eingeloggt).
 *
 * Der `RouterContext` enthält den QueryClient (für `loader`-Hooks). Der
 * Auth-Status fragen wir hier direkt über `useSession()` ab; im
 * Sub-Layout `_auth.tsx` wird er als Guard verwendet.
 */
import { createRootRouteWithContext, Link, Outlet, useNavigate } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { signOut, useSession } from "~/lib/auth-client";
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
  const { data, isPending } = useSession();
  const navigate = useNavigate();

  return (
    <header className="border-b border-stone-200 bg-white">
      <nav className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-6">
        <Link to="/" className="font-semibold text-lg">
          Heb ab!
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {isPending ? (
            <span className="text-sm text-stone-400">…</span>
          ) : data?.user ? (
            <>
              <span className="text-sm text-stone-600">
                Servus, <strong className="text-stone-900">{data.user.name}</strong>
              </span>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  await navigate({ to: "/" });
                }}
                className="rounded border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100"
              >
                Abmelden
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm text-stone-700 hover:text-stone-900">
                Anmelden
              </Link>
              <Link
                to="/register"
                className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
              >
                Registrieren
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
