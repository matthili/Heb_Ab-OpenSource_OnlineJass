/**
 * Präsenz-Provider für Online-/Zuletzt-gesehen-Punkte an Namen.
 *
 * Statt pro `<UserName>` eine eigene Anfrage zu feuern, sammelt der Provider
 * alle interessierten User-IDs (ref-gezählt) und fragt sie **gebündelt** über
 * `GET /api/lobby/presence/status?ids=…` ab (Poll alle 25 s). Der Server setzt
 * dabei die Präsenz-Sichtbarkeit jedes Ziel-Users durch — wer nicht sichtbar
 * ist, kommt als `{ online: false, lastSeenAt: null }` zurück (kein Leak).
 *
 * Zwei Contexts, damit das Abonnieren stabil bleibt: ein **Subscribe**-Context
 * (stabile Referenz → Effect läuft nur einmal pro ID) und ein **Daten**-Context
 * (ändert sich beim Poll → Punkte aktualisieren sich).
 */
import { useQuery } from "@tanstack/react-query";
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

import { api } from "~/lib/api";
import { useSession } from "~/lib/auth-client";

export type PresenceState = "offline" | "online" | "playing" | "afk";

export interface PresenceStatus {
  state: PresenceState;
  lastSeenAt: string | null;
}

type StatusMap = Record<string, PresenceStatus>;

interface SubscribeApi {
  subscribe: (userId: string) => () => void;
}

const SubscribeContext = createContext<SubscribeApi | null>(null);
const DataContext = createContext<StatusMap>({});

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const myId = session?.user?.id;

  const counts = useRef<Map<string, number>>(new Map());
  const [ids, setIds] = useState<string[]>([]);
  const flushTimer = useRef<number | null>(null);

  // Änderungen am ID-Set gebündelt übernehmen (viele Namen mounten gleichzeitig).
  const scheduleFlush = useCallback(() => {
    if (flushTimer.current != null) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      setIds([...counts.current.keys()].sort());
    }, 250);
  }, []);

  const subscribe = useCallback(
    (userId: string) => {
      counts.current.set(userId, (counts.current.get(userId) ?? 0) + 1);
      scheduleFlush();
      return () => {
        const n = (counts.current.get(userId) ?? 1) - 1;
        if (n <= 0) counts.current.delete(userId);
        else counts.current.set(userId, n);
        scheduleFlush();
      };
    },
    [scheduleFlush]
  );

  const { data } = useQuery<{ statuses: StatusMap }>({
    queryKey: ["presence-status", ids],
    queryFn: () => api(`/api/lobby/presence/status?ids=${encodeURIComponent(ids.join(","))}`),
    enabled: !!myId && ids.length > 0,
    refetchInterval: 25_000,
    staleTime: 20_000,
  });

  const subApi = useMemo<SubscribeApi>(() => ({ subscribe }), [subscribe]);
  const statuses = data?.statuses ?? {};

  return (
    <SubscribeContext.Provider value={subApi}>
      <DataContext.Provider value={statuses}>{children}</DataContext.Provider>
    </SubscribeContext.Provider>
  );
}

/** Status eines Users (oder undefined, wenn unbekannt/lädt/ohne Provider). */
export function usePresence(userId: string | undefined): PresenceStatus | undefined {
  const sub = useContext(SubscribeContext);
  const data = useContext(DataContext);
  useEffect(() => {
    if (!sub || !userId) return;
    return sub.subscribe(userId);
  }, [sub, userId]);
  return userId ? data[userId] : undefined;
}

/** Tailwind-Farbe pro Status. */
const STATE_COLOR: Record<PresenceState, string> = {
  online: "bg-emerald-500",
  playing: "bg-sky-500",
  afk: "bg-amber-500",
  offline: "bg-stone-400",
};

/**
 * Kleiner Präsenz-Punkt: grün = online, blau = spielt gerade, orange = AFK,
 * grau = offline (mit „zuletzt gesehen" im Tooltip). Unbekannt/versteckt/lädt
 * oder offline-ohne-Zeitstempel → nichts (kein Punkt, kein Platz).
 */
export function PresenceDot({ userId }: { userId: string | undefined }) {
  const { t } = useTranslation();
  const status = usePresence(userId);
  if (!status) return null;

  // Offline ohne bekanntes „zuletzt gesehen" → gar nichts rendern.
  if (status.state === "offline" && !status.lastSeenAt) return null;

  const label =
    status.state === "offline"
      ? t("social.presence.lastSeenAt", { when: new Date(status.lastSeenAt!).toLocaleString() })
      : t(`social.presence.${status.state}`);

  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${STATE_COLOR[status.state]}`}
      title={label}
      aria-label={label}
    />
  );
}
