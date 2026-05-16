/**
 * In-Memory-Mutex pro Game-ID.
 *
 * Verhindert parallele Move-Verarbeitung für dasselbe Spiel. Konkretes Race
 * ohne Lock: ein User-Move startet driveAIsLoop, während diese auf
 * `sleep(200)` zwischen den KI-Iterationen wartet, kommt ein nächstes
 * `game:move` rein — beide Pfade rufen `applyMove` mit demselben Sitz auf
 * dem (kurz veralteten) State auf, der zweite scheitert mit InvalidMoveError
 * oder einer Unique-Constraint auf `Move.(gameId, seq)`.
 *
 * Implementation: pro `gameId` ein Promise-Chain. `withLock(gameId, fn)`
 * wartet auf den letzten Eintrag und hängt sich dran. Per-Game-Granularität
 * reicht (verschiedene Tische blockieren sich nicht).
 *
 * **Multi-Instance-Hinweis**: in-memory greift nur lokal. Sobald wir mit
 * mehreren API-Containern laufen (M11), muss ein verteilter Lock her —
 * z.B. via Redis `SET … NX EX …` mit Renewal. Dann tauschen wir nur diese
 * Klasse aus, Aufrufstellen bleiben identisch.
 */
import { Injectable } from "@nestjs/common";

@Injectable()
export class GameLockService {
  private chains = new Map<string, Promise<unknown>>();

  /**
   * Führt `fn` aus, sobald alle vorherigen Locks für diese `gameId` durch sind.
   * Liefert dessen Rückgabewert.
   */
  async withLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(gameId) ?? Promise.resolve();
    const next = previous.then(fn, fn); // auch nach Reject weiterlaufen
    // Kette in der Map halten, aber nach Abschluss aufräumen, damit die Map
    // nicht über Tage füllt.
    const tracked: Promise<unknown> = next.finally(() => {
      if (this.chains.get(gameId) === tracked) {
        this.chains.delete(gameId);
      }
    });
    this.chains.set(gameId, tracked);
    return next as Promise<T>;
  }
}
