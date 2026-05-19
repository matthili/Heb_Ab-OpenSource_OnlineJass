/**
 * Globaler Listener für das `auth:session-superseded`-Event vom
 * GameGateway. Wird gefeuert, wenn der Server diesen Socket
 * disconnectet, weil eine neuere Anmeldung des gleichen Users das
 * Per-User-Socket-Limit gerissen hat.
 *
 * UX: Vollbild-Modal, der den Tab effektiv "einfriert" — Hard-Reload
 * auf die Login-Seite ist die saubere Geste, weil:
 *   - die Session in diesem Tab könnte noch gültig sein (Cookie nicht
 *     widerrufen, sondern nur die WS-Verbindung gedroppt)
 *   - aber dieser Tab ist faktisch "veraltet" — der User spielt
 *     wahrscheinlich auf dem anderen Gerät weiter.
 *
 * Wir bieten dem User die Wahl: „Hier weitermachen" → reload (re-connect
 * WS, ggf. erneut Disconnect, falls Limit weiter reached) ODER
 * „Zur Login-Seite" → sauberer Logout-Flow.
 */
import { useEffect, useState } from "react";

import { getLobbySocket } from "~/lib/ws";

export function SessionSupersededBanner() {
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    const s = getLobbySocket();
    const handler = (payload: { message?: string }) => {
      setReason(payload?.message ?? "Diese Verbindung wurde durch eine andere ersetzt.");
    };
    s.on("auth:session-superseded", handler);
    return () => {
      s.off("auth:session-superseded", handler);
    };
  }, []);

  if (!reason) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="superseded-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-stone-900/60 p-4"
    >
      <div className="max-w-md w-full rounded-lg bg-jass-paper border border-jass-paperEdge shadow-xl p-6 space-y-3">
        <h2 id="superseded-title" className="text-lg font-bold text-jass-ink">
          Sitzung beendet
        </h2>
        <p className="text-sm text-jass-inkSoft">{reason}</p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-jass-secondary"
          >
            Hier weitermachen
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/login";
            }}
            className="btn-jass-primary"
          >
            Zur Anmeldung
          </button>
        </div>
      </div>
    </div>
  );
}
