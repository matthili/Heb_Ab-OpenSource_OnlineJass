/**
 * Globaler Manager für Privatnachricht-Fenster (DM).
 *
 * Wird einmal im Root gemountet (`<DmWindowProvider>` in `main.tsx`, neben dem
 * `ToastProvider`). Per `useDmWindows().open(userId, name)` lässt sich von überall
 * ein DM-Fenster zu einem User öffnen — **maximal eines pro User** (erneutes
 * Öffnen holt das bestehende Fenster nur in den Vordergrund). Die Fenster liegen
 * als floatende, minimier-/schließbare Layer unten rechts (über Toasts? nein:
 * z-40, Toasts liegen darüber). Jedes Fenster nutzt intern `ChatPanel` mit dem
 * `dm:<a>:<b>`-Kanal.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ChatPanel } from "~/features/chat/ChatPanel";
import { makeDmChannelKey } from "~/features/chat/dm";
import { useSession } from "~/lib/auth-client";

interface DmTarget {
  userId: string;
  name: string;
}

interface DmWindowsApi {
  /** Öffnet (oder fokussiert) ein DM-Fenster zu diesem User. */
  open: (userId: string, name: string) => void;
  close: (userId: string) => void;
}

const DmWindowsContext = createContext<DmWindowsApi | null>(null);

/** Zugriff auf den DM-Fenster-Manager. Außerhalb des Providers → Fehler. */
export function useDmWindows(): DmWindowsApi {
  const ctx = useContext(DmWindowsContext);
  if (!ctx) throw new Error("useDmWindows muss innerhalb von <DmWindowProvider> verwendet werden.");
  return ctx;
}

export function DmWindowProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<DmTarget[]>([]);

  const open = useCallback((userId: string, name: string) => {
    setWindows((ws) => (ws.some((w) => w.userId === userId) ? ws : [...ws, { userId, name }]));
  }, []);
  const close = useCallback((userId: string) => {
    setWindows((ws) => ws.filter((w) => w.userId !== userId));
  }, []);

  const api = useMemo<DmWindowsApi>(() => ({ open, close }), [open, close]);

  return (
    <DmWindowsContext.Provider value={api}>
      {children}
      <DmWindowLayer windows={windows} onClose={close} />
    </DmWindowsContext.Provider>
  );
}

function DmWindowLayer({
  windows,
  onClose,
}: {
  windows: DmTarget[];
  onClose: (userId: string) => void;
}) {
  const { data: session } = useSession();
  const myId = session?.user?.id;
  if (!myId || windows.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-0 right-0 z-40 flex max-w-full items-end gap-3 overflow-x-auto p-3">
      {windows.map((w) => (
        <DmWindow key={w.userId} myId={myId} target={w} onClose={() => onClose(w.userId)} />
      ))}
    </div>
  );
}

function DmWindow({
  myId,
  target,
  onClose,
}: {
  myId: string;
  target: DmTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [minimized, setMinimized] = useState(false);
  return (
    <div className="pointer-events-auto w-80 max-w-[90vw] overflow-hidden rounded-lg border border-stone-300 bg-white shadow-xl">
      <div className="flex items-center justify-between gap-2 bg-stone-900 px-3 py-1.5 text-sm text-white">
        <span className="truncate font-medium">{target.name}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMinimized((m) => !m)}
            aria-label={minimized ? t("social.dm.restore") : t("social.dm.minimize")}
            className="rounded px-1.5 hover:bg-white/20"
          >
            {minimized ? "▢" : "—"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("social.dm.close")}
            className="rounded px-1.5 hover:bg-white/20"
          >
            ✕
          </button>
        </div>
      </div>
      {!minimized && (
        <ChatPanel
          channelKey={makeDmChannelKey(myId, target.userId)}
          title={target.name}
          hideHeader
          className="rounded-none border-0"
        />
      )}
    </div>
  );
}
