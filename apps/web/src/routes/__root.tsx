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

import { signOut, useSession } from "~/lib/auth-client";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-5xl w-full px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
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
