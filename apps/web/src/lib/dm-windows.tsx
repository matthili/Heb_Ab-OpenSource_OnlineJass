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
 *
 * **Ungelesen + Hinweis**: Der Provider lauscht global auf `chat:dm-received`
 * (persönlicher Kanal, vom ChatGateway). Trifft eine PN ein, während das
 * zugehörige Fenster nicht sichtbar offen ist (kein Fenster oder minimiert),
 * öffnet er ein **minimiertes** Fenster, erhöht den Ungelesen-Zähler und zeigt
 * einen anklickbaren Toast. Sichtbar-offene Fenster bekommen die Nachricht
 * ohnehin live über `useChat` — dann kein Badge/Toast.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { ChatPanel } from "~/features/chat/ChatPanel";
import { makeDmChannelKey } from "~/features/chat/dm";
import { useSession } from "~/lib/auth-client";
import { useToast } from "~/lib/toast";
import { getLobbySocket } from "~/lib/ws";

interface DmWindowState {
  userId: string;
  name: string;
  minimized: boolean;
  unread: number;
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

/** HTML aus einer Nachricht entfernen — für die Toast-Vorschau (nur Text). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

export function DmWindowProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<DmWindowState[]>([]);
  const { showToast } = useToast();
  const { data: session } = useSession();
  const myId = session?.user?.id;

  // Synchroner Spiegel für den Socket-Handler (Closure sieht sonst alten State).
  const windowsRef = useRef<DmWindowState[]>([]);
  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  const open = useCallback((userId: string, name: string) => {
    setWindows((ws) => {
      const existing = ws.find((w) => w.userId === userId);
      // Vorhandenes Fenster: einblenden + als gelesen markieren.
      if (existing) {
        return ws.map((w) =>
          w.userId === userId ? { ...w, minimized: false, unread: 0, name } : w
        );
      }
      return [...ws, { userId, name, minimized: false, unread: 0 }];
    });
  }, []);

  const close = useCallback((userId: string) => {
    setWindows((ws) => ws.filter((w) => w.userId !== userId));
  }, []);

  // Minimieren/Wiederherstellen; beim Wiederherstellen Ungelesen zurücksetzen.
  const setMinimized = useCallback((userId: string, minimized: boolean) => {
    setWindows((ws) =>
      ws.map((w) =>
        w.userId === userId ? { ...w, minimized, unread: minimized ? w.unread : 0 } : w
      )
    );
  }, []);

  // Globaler Neue-PN-Listener (nur wenn eingeloggt).
  useEffect(() => {
    if (!myId) return;
    const socket = getLobbySocket();
    function onDmReceived(view: { senderId?: string; senderName?: string; body?: string }) {
      const fromId = view.senderId;
      const fromName = view.senderName ?? "?";
      if (!fromId || fromId === myId) return;
      const existing = windowsRef.current.find((w) => w.userId === fromId);
      // Sichtbar offen → die Nachricht kommt live über useChat; nichts tun.
      if (existing && !existing.minimized) return;

      setWindows((ws) => {
        const ex = ws.find((w) => w.userId === fromId);
        if (!ex) return [...ws, { userId: fromId, name: fromName, minimized: true, unread: 1 }];
        return ws.map((w) => (w.userId === fromId ? { ...w, unread: w.unread + 1 } : w));
      });

      const preview = stripHtml(view.body ?? "");
      showToast(
        <button type="button" onClick={() => open(fromId, fromName)} className="text-left">
          💬 <strong>{fromName}</strong>
          {preview ? `: ${preview.slice(0, 80)}` : ""}
        </button>,
        { variant: "info" }
      );
    }
    socket.on("chat:dm-received", onDmReceived);
    return () => {
      socket.off("chat:dm-received", onDmReceived);
    };
  }, [myId, open, showToast]);

  const api = useMemo<DmWindowsApi>(() => ({ open, close }), [open, close]);

  return (
    <DmWindowsContext.Provider value={api}>
      {children}
      <DmWindowLayer windows={windows} onClose={close} onMinimize={setMinimized} />
    </DmWindowsContext.Provider>
  );
}

function DmWindowLayer({
  windows,
  onClose,
  onMinimize,
}: {
  windows: DmWindowState[];
  onClose: (userId: string) => void;
  onMinimize: (userId: string, minimized: boolean) => void;
}) {
  const { data: session } = useSession();
  const myId = session?.user?.id;
  if (!myId || windows.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-0 right-0 z-40 flex max-w-full items-end gap-3 overflow-x-auto p-3">
      {windows.map((w) => (
        <DmWindow
          key={w.userId}
          myId={myId}
          target={w}
          onClose={() => onClose(w.userId)}
          onMinimize={(min) => onMinimize(w.userId, min)}
        />
      ))}
    </div>
  );
}

function DmWindow({
  myId,
  target,
  onClose,
  onMinimize,
}: {
  myId: string;
  target: DmWindowState;
  onClose: () => void;
  onMinimize: (minimized: boolean) => void;
}) {
  const { t } = useTranslation();
  const minimized = target.minimized;
  return (
    <div className="pointer-events-auto w-80 max-w-[90vw] overflow-hidden rounded-lg border border-stone-300 bg-white shadow-xl">
      <div className="flex items-center justify-between gap-2 bg-stone-900 px-3 py-1.5 text-sm text-white">
        <span className="flex items-center gap-1.5 truncate font-medium">
          <span className="truncate">{target.name}</span>
          {minimized && target.unread > 0 && (
            <span
              className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-600 px-1 text-xs font-semibold"
              aria-label={t("social.dm.unread", { count: target.unread })}
            >
              {target.unread}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMinimize(!minimized)}
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
