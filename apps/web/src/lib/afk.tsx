/**
 * AFK-/Pause-Modus.
 *
 * Globaler Provider (im Root gemountet). Hält den AFK-Zustand des eingeloggten
 * Users — initial via `GET /api/lobby/afk`, live über alle Geräte via das
 * WS-Event `presence:afk` (persönlicher Kanal). `setAfk` schreibt per
 * `POST /api/lobby/afk`; der Server pusht das Event an alle Geräte zurück.
 *
 * Ist AFK aktiv, legt sich ein bildschirmfüllendes Overlay (`AfkOverlay`,
 * z-30) über die App: Lobby, Tische und Lobby-Chat sind verdeckt/blockiert.
 * DM-Fenster (z-40) und Toasts (z-50) liegen darüber und bleiben bedienbar —
 * Privatnachrichten erreichen einen also weiterhin. Mittig „AFK beenden".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "~/lib/api";
import { useSession } from "~/lib/auth-client";
import { useToast } from "~/lib/toast";
import { useUserEvents } from "~/lib/ws";

interface AfkApi {
  afk: boolean;
  setAfk: (afk: boolean) => void;
  pending: boolean;
}

const AfkContext = createContext<AfkApi | null>(null);

export function useAfk(): AfkApi {
  const ctx = useContext(AfkContext);
  if (!ctx) throw new Error("useAfk muss innerhalb von <AfkProvider> verwendet werden.");
  return ctx;
}

export function AfkProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const myId = session?.user?.id;
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [afk, setAfkState] = useState(false);

  // Initialzustand vom Server (nur eingeloggt).
  const { data } = useQuery<{ afk: boolean }>({
    queryKey: ["lobby", "afk"],
    queryFn: () => api("/api/lobby/afk"),
    enabled: !!myId,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (data) setAfkState(data.afk);
  }, [data]);

  // Live über alle Geräte des Users.
  const onAfkEvent = useCallback((p: unknown) => {
    const afkVal = (p as { afk?: boolean } | null)?.afk;
    if (typeof afkVal === "boolean") setAfkState(afkVal);
  }, []);
  useUserEvents("presence:afk", onAfkEvent);

  const { mutate, isPending } = useMutation({
    mutationFn: (next: boolean) =>
      api<{ afk: boolean }>("/api/lobby/afk", { method: "POST", body: { afk: next } }),
    onSuccess: (res) => {
      setAfkState(res.afk);
      void queryClient.invalidateQueries({ queryKey: ["lobby", "presence"] });
    },
    onError: (err) => {
      // Häufigster Fall: AFK an, während man an einem Tisch sitzt → 403.
      showToast(err instanceof ApiError ? err.message : "AFK fehlgeschlagen.", {
        variant: "warning",
      });
    },
  });
  const setAfk = useCallback((next: boolean) => mutate(next), [mutate]);

  const isAfk = !!myId && afk;
  const value = useMemo<AfkApi>(
    () => ({ afk: isAfk, setAfk, pending: isPending }),
    [isAfk, setAfk, isPending]
  );

  return (
    <AfkContext.Provider value={value}>
      {children}
      {isAfk && <AfkOverlay onEnd={() => setAfk(false)} pending={isPending} />}
    </AfkContext.Provider>
  );
}

function AfkOverlay({ onEnd, pending }: { onEnd: () => void; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("afk.overlay.title")}
      className="fixed inset-0 z-30 flex items-center justify-center bg-stone-900/80 p-4 backdrop-blur-sm"
    >
      <div className="max-w-sm space-y-4 rounded-lg border border-stone-300 bg-white p-6 text-center shadow-xl">
        <div className="text-4xl" aria-hidden="true">
          ☕
        </div>
        <h2 className="text-lg font-semibold text-stone-900">{t("afk.overlay.title")}</h2>
        <p className="text-sm text-stone-600">{t("afk.overlay.body")}</p>
        <button
          type="button"
          onClick={onEnd}
          disabled={pending}
          className="btn-jass-primary disabled:opacity-50"
        >
          {t("afk.overlay.end")}
        </button>
      </div>
    </div>
  );
}

/**
 * Header-Button „AFK / Pause". Nur bedienbar, solange man an keinem Tisch
 * sitzt (sonst könnte man eine Partie blockieren). Beim AFK selbst verdeckt
 * das Overlay den Header, daher ist der Button faktisch nur im Online-Zustand
 * sichtbar/relevant.
 */
export function AfkButton() {
  const { t } = useTranslation();
  const { afk, setAfk, pending } = useAfk();
  const { data: myTables } = useQuery<{ tables: unknown[] }>({
    queryKey: ["lobby", "my-tables"],
    queryFn: () => api("/api/lobby/my-tables"),
    staleTime: 15_000,
  });
  const atTable = (myTables?.tables.length ?? 0) > 0;
  const disabled = afk || pending || atTable;

  return (
    <button
      type="button"
      onClick={() => setAfk(true)}
      disabled={disabled}
      title={atTable ? t("afk.button.atTableHint") : undefined}
      className="rounded border border-jass-paperEdge px-2 py-1 text-sm font-medium text-jass-inkSoft transition-colors hover:text-jass-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      {t("afk.button.label")}
    </button>
  );
}
