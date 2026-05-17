/**
 * Root-Route. Hier landen die globalen Layout-Elemente (Header, Footer,
 * Toaster). In M7-A noch minimal — Auth-Guard und i18n-Provider kommen
 * mit M7-B.
 */
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Router-Context: alle Routen können auf den QueryClient zugreifen (für
 * `loader`-Hooks via `useRouteContext`). `export` ist Pflicht — TanStack
 * generiert in `routeTree.gen.ts` Typen, die diesen Namen referenzieren,
 * sonst meckert TS mit TS4023 ("name cannot be named").
 */
export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-stone-200 bg-white">
        <nav className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-6">
          <Link to="/" className="font-semibold text-lg">
            Heb ab!
          </Link>
          <span className="text-sm text-stone-500">M7-A · Frontend-Skelett</span>
        </nav>
      </header>
      <main className="flex-1 mx-auto max-w-5xl w-full px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
