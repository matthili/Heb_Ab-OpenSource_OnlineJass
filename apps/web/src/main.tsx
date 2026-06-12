/**
 * Bootstrap der Spiel-SPA.
 *
 * Was hier passiert:
 *   - QueryClient für TanStack Query (REST + WS-State-Caching)
 *   - Router-Provider für TanStack Router
 *   - `routeTree` ist autogeneriert (siehe vite.config + TanStackRouterVite-
 *     Plugin); die `routeTree.gen.ts` entsteht beim ersten `pnpm dev`.
 *
 * `routeTree.gen.ts` ist `.gitignore`d (in `src/routeTree.gen.ts`) — wir
 * checken den generierten Code nicht ein, weil er sich bei jedem
 * Route-File-Change ändert.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// EB Garamond als Headline-Serif. Self-hosted via @fontsource — keine
// externen CDN-Calls (DSGVO-freundlich). Wir laden 400 (Regular) und
// 600 (Semibold), die im CSS via `font-family: "EB Garamond"` benutzt
// werden. Body bleibt System-UI-Sans für gute Lesbarkeit.
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/600.css";
import "./i18n/index.js"; // Side-Effect: initialisiert i18next vor dem ersten Render
import { DmWindowProvider } from "./lib/dm-windows.js";
import { applyThemeFromStorage } from "./lib/theme.js";
import { ToastProvider } from "./lib/toast.js";
import { registerServiceWorker } from "./lib/pwa.js";
import { routeTree } from "./routeTree.gen.js";
import "./styles.css";

// **Theme früh setzen** — vor dem ersten React-Render. Sonst sehen
// User mit Hi-Contrast-Preference einen kurzen Default-Flash.
applyThemeFromStorage();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Lobby-/Tisch-Daten werden über WS push-aktualisiert, REST ist
      // nur Initial-Load + Fallback. 60 s Stale-Time reduziert
      // redundante Fetches im UI.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: { queryClient },
});

// Type-Augmentation für TanStack Router — sonst meckert TS über
// `useRouteContext` ohne queryClient-Wissen.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root nicht im DOM gefunden");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DmWindowProvider>
          <RouterProvider router={router} />
        </DmWindowProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>
);

// Service Worker erst NACH dem ersten Render registrieren, damit die SW-
// Bootstrap-Kosten nicht den First-Paint blockieren.
registerServiceWorker();
