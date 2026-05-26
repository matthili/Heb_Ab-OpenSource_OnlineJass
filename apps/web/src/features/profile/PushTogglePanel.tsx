/**
 * Push-Benachrichtigungen — Opt-in pro Browser/Device.
 *
 * Browser-Konzept:
 *   1. Notification.permission anfragen (`Notification.requestPermission()`)
 *   2. SW-Registration holen (`navigator.serviceWorker.ready`)
 *   3. `pushManager.subscribe()` mit dem VAPID-Public-Key vom Server
 *   4. Subscription-Objekt an `/api/push/subscribe` posten
 *
 * Server: schickt anschließend bei relevanten Events (Join-Request) eine
 * Push, der eingebundene `push-handler.js` rendert sie als Notification.
 *
 * Dieser Toggle ist eine **lokale** Einstellung — der Server speichert die
 * Subscription pro `endpoint` (= pro Browser/Device). Ein User mit zwei
 * Geräten muss auf beiden separat zustimmen.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, ApiError } from "~/lib/api";

interface PushInfo {
  publicKey: string | null;
  enabled: boolean;
}

export function PushTogglePanel() {
  const queryClient = useQueryClient();
  const info = useQuery<PushInfo>({
    queryKey: ["push", "info"],
    queryFn: () => api("/api/push/public-key"),
    staleTime: 60_000,
  });
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Beim ersten Render: prüfen, ob der Browser schon eine Subscription hat.
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSubscribed(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(sub !== null);
      } catch {
        if (!cancelled) setSubscribed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subMut = useMutation({
    mutationFn: async () => {
      if (!info.data?.publicKey) throw new Error("Push ist serverseitig nicht konfiguriert.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Benachrichtigungen wurden nicht erlaubt.");
      const reg = await navigator.serviceWorker.ready;
      // Cast notwendig, weil `Uint8Array<ArrayBufferLike>` in neueren TS-
      // Targets nicht mehr automatisch zu `ArrayBuffer` aliasiert — die
      // Browser-API akzeptiert `BufferSource` zur Laufzeit.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.data.publicKey) as BufferSource,
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Push-Subscription unvollständig — Browser-Fehler?");
      }
      await api("/api/push/subscribe", {
        method: "POST",
        body: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          userAgent: navigator.userAgent.slice(0, 200),
        },
      });
    },
    onSuccess: () => {
      setSubscribed(true);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["push", "info"] });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  const unsubMut = useMutation({
    mutationFn: async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await api("/api/push/unsubscribe", {
        method: "POST",
        body: { endpoint },
      });
    },
    onSuccess: () => {
      setSubscribed(false);
      setError(null);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  const supported = "serviceWorker" in navigator && "PushManager" in window;

  if (!supported) {
    return (
      <p className="text-sm text-stone-600 italic">
        Dieser Browser unterstützt keine Push-Benachrichtigungen.
      </p>
    );
  }
  if (info.isPending) {
    return <p className="text-sm text-stone-500">Lade Push-Konfiguration …</p>;
  }
  if (!info.data?.enabled) {
    return (
      <p className="text-sm text-stone-600 italic">
        Der Server hat noch keine VAPID-Schlüssel konfiguriert — Push ist aktuell deaktiviert.
      </p>
    );
  }

  return (
    <fieldset className="border-t border-stone-200 pt-3 space-y-2">
      <legend className="text-sm font-medium text-stone-700">Push-Benachrichtigungen</legend>
      <p className="text-xs text-stone-500">
        Erhalte Browser-Push, wenn jemand an deinem Tisch beitreten möchte (auch wenn dein Tab
        gerade geschlossen ist). Pro Browser/Gerät separat — die Einstellung gilt nicht
        Account-weit.
      </p>
      {subscribed ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <span aria-hidden="true">●</span> Aktiv auf diesem Gerät
          </span>
          <button
            type="button"
            onClick={() => unsubMut.mutate()}
            disabled={unsubMut.isPending}
            className="rounded border border-stone-300 px-3 py-1 text-xs hover:bg-stone-100 disabled:opacity-50"
          >
            Deaktivieren
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => subMut.mutate()}
          disabled={subMut.isPending}
          className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {subMut.isPending ? "Aktiviere …" : "Push aktivieren"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * VAPID-Public-Key (URL-Base64) in Uint8Array — exakt das Format, das
 * `pushManager.subscribe({ applicationServerKey })` erwartet.
 */
function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  const std = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(std);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
