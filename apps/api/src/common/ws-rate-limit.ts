/**
 * **WebSocket-Rate-Limit** pro Socket, mit Sliding-Window-Zähler.
 *
 * Hintergrund: Better Auth deckt nur die HTTP-Auth-Routes ab — eingehende
 * Socket.IO-Events laufen daran vorbei. Ein authentifizierter User
 * könnte mit gültiger Session beliebig viele `game:move`-Frames spammen;
 * jeder Frame zieht einen `loadRoundState` aus Redis + Engine-Validation,
 * also nicht-trivial Server-Last.
 *
 * **Design-Wahl Sliding-Window statt Token-Bucket:**
 *   - Wir geben ein hartes „max N Events in den letzten W ms"-Statement —
 *     einfacher zu reasonieren, schwerer zu missbrauchen als ein
 *     Bucket, der sich konstant wieder füllt.
 *   - Bei normaler Spielgeschwindigkeit (1 Move alle paar Sekunden)
 *     fallen wir nie in die Nähe des Limits. Wir wollen nur die
 *     pathologischen Fälle erschlagen.
 *
 * **Eskalation:**
 *   - 1 Verstoß: Event verwerfen, `game:error` an den Socket.
 *   - Verstöße akkumulieren über einen längeren Sliding-Window (1 min).
 *     Bei >= `disconnectAfterViolations` Verstößen disconnecten wir.
 *
 * **Storage:** in-memory pro Socket. Bei Multi-Instance mit
 * Redis-Adapter ist das OK, weil ein Socket genau auf einer Instanz
 * lebt. Globaler User-Rate-Limit (über mehrere parallele Connections
 * hinweg) wäre Redis-basiert; das ist hier explizit nicht abgedeckt
 * und müsste ein Folge-Sprint sein.
 */

export interface WsRateLimitConfig {
  /** Limits pro Event-Name. Default greift, falls Event nicht gelistet. */
  readonly perEvent: Readonly<Record<string, { windowMs: number; max: number }>>;
  /** Fallback-Limit für Events ohne expliziten Eintrag. */
  readonly default: { windowMs: number; max: number };
  /** Wie viele Verstöße über `violationWindowMs` ms → Disconnect. */
  readonly disconnectAfterViolations: number;
  /** Sliding-Window-Länge für Verstoß-Akkumulation. */
  readonly violationWindowMs: number;
}

/**
 * Konservative Defaults — bewusst groß genug, dass echte Nutzer sie
 * nie sehen, klein genug dass Scripted-Spam keine Server-Last erzeugt.
 */
export const DEFAULT_WS_RATE_LIMIT: WsRateLimitConfig = {
  perEvent: {
    // Game-Mutations: höchstens 10 in 10s — echtes Jass-Tempo ist
    // mindestens 2-3 s pro Zug, also weit drunter.
    "game:move": { windowMs: 10_000, max: 10 },
    "game:announce": { windowMs: 10_000, max: 10 },
    "game:announce-stoeck": { windowMs: 10_000, max: 10 },
    // Join wird vom Client typischerweise einmalig pro Game gesendet.
    // 5 in 10 s reichen für Reconnect-Versuche, blocken aber Flood.
    "game:join": { windowMs: 10_000, max: 5 },
    // Lobby-/Chat-Subscriptions: 20 in 10 s — reicht für hektisches
    // Hin-Hernavigieren, fängt aber Auto-Scripts.
    "lobby:subscribe-list": { windowMs: 10_000, max: 20 },
    "lobby:unsubscribe-list": { windowMs: 10_000, max: 20 },
    "lobby:subscribe-table": { windowMs: 10_000, max: 20 },
    "lobby:unsubscribe-table": { windowMs: 10_000, max: 20 },
    "chat:subscribe": { windowMs: 10_000, max: 20 },
    "chat:unsubscribe": { windowMs: 10_000, max: 20 },
  },
  default: { windowMs: 10_000, max: 30 },
  disconnectAfterViolations: 5,
  violationWindowMs: 60_000,
};

/**
 * Stateful Tracker pro Socket. Speichert pro Event-Typ die Timestamps
 * der letzten N Events; verwirft alte, zählt aktuelle.
 */
export class SocketRateTracker {
  /** Timestamps pro Event-Name (ms seit epoch). */
  private readonly events = new Map<string, number[]>();
  /** Timestamps der bisherigen Verstöße. */
  private readonly violations: number[] = [];

  constructor(private readonly config: WsRateLimitConfig = DEFAULT_WS_RATE_LIMIT) {}

  /**
   * Prüft, ob ein eingehendes Event erlaubt ist.
   *
   * Returns:
   *   `{ allow: true }` → Event durchlassen.
   *   `{ allow: false, disconnect: false }` → Event verwerfen, Socket lebt weiter.
   *   `{ allow: false, disconnect: true }` → so viele Verstöße, dass wir
   *      die Connection killen (Caller sollte audit + socket.disconnect).
   */
  check(
    event: string,
    now: number = Date.now()
  ): { allow: true } | { allow: false; disconnect: boolean } {
    const limit = this.config.perEvent[event] ?? this.config.default;
    const arr = this.events.get(event) ?? [];
    const cutoff = now - limit.windowMs;
    // Älter als das Fenster → raus. (filter ist O(n), aber n ist
    // beschränkt durch limit.max + Pufferspielraum.)
    const fresh = arr.filter((t) => t > cutoff);
    if (fresh.length >= limit.max) {
      // Verstoß registrieren.
      this.violations.push(now);
      const vCutoff = now - this.config.violationWindowMs;
      const freshViolations = this.violations.filter((t) => t > vCutoff);
      this.violations.length = 0;
      this.violations.push(...freshViolations);
      this.events.set(event, fresh);
      return {
        allow: false,
        disconnect: freshViolations.length >= this.config.disconnectAfterViolations,
      };
    }
    fresh.push(now);
    this.events.set(event, fresh);
    return { allow: true };
  }
}
