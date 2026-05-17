/**
 * Periodischer Sweeper, der Tische mit fälligem Auto-Fill-Timer auffüllt
 * und ggf. das Spiel startet.
 *
 * **Fälligkeit**: Ein Tisch ist „dran", wenn alle folgenden Bedingungen
 * erfüllt sind:
 *   - `status === WAITING` (kein Spiel läuft)
 *   - `autoFillSeconds !== null` (Auto-Fill nicht abgeschaltet)
 *   - Sitz-Anzahl < 4 (sonst würde tryAutoStartGame() eh greifen)
 *   - `lastSeatChangeAt + autoFillSeconds <= now()`
 *
 * **Timer-Reset bei Spieler-Join** (User-Entscheidung 1): Jede Sitz-Mutation
 * im LobbyService aktualisiert `lastSeatChangeAt`. Ein neuer Spieler-Join
 * verschiebt die Fälligkeit also automatisch um weitere `autoFillSeconds`
 * nach vorn — gibt menschlichen Spielern Zeit, sich noch zu sammeln.
 *
 * **Konkurrenz**: Wir laufen Single-Instance (M11 wechselt auf Redis-Sweeper
 * mit verteiltem Lock). Innerhalb einer Instanz schützt die Prisma-Transaktion
 * gegen Race-Conditions mit gleichzeitigen Joins.
 *
 * **Test-Hook**: `tick()` ist öffentlich, damit Integration-Tests die
 * Sweeper-Logik deterministisch anstoßen können, ohne 30 s auf den
 * Intervall-Timer zu warten. Per `DISABLE_AUTO_FILL_SWEEPER=1` im env
 * deaktivieren wir die periodische `setInterval`-Schleife in Tests
 * komplett — die rufen `tick()` direkt.
 */
import {
  Inject,
  Injectable,
  Logger,
  forwardRef,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { LobbyTableStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";
import { LobbyService } from "./lobby.service.js";

/** Wie oft der Sweeper tickt. 2 s ist ein guter Kompromiss aus „pünktlich"
 *  und „nicht zu lautes Logging im idle-state". Bei `autoFillSeconds: 30`
 *  ergibt das eine maximale Drift von ~2 s. */
const TICK_INTERVAL_MS = 2_000;

@Injectable()
export class AutoFillService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AutoFillService.name);
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    // forwardRef wegen zirkulärer Abhängigkeit LobbyService ↔ AutoFillService.
    // LobbyService importiert AutoFillService (für lastSeatChangeAt-Updates
    // brauchen wir eigentlich nicht — das macht der Service selbst, daher
    // ist die Abhängigkeit hier 1-Richtungs. Aber wir lassen forwardRef als
    // Sicherheits-Netz, falls in M6-E noch was hinzukommt).
    @Inject(forwardRef(() => LobbyService))
    private readonly lobby: LobbyService
  ) {}

  onModuleInit(): void {
    if (process.env["DISABLE_AUTO_FILL_SWEEPER"] === "1") {
      this.log.log("Auto-Fill-Sweeper deaktiviert (DISABLE_AUTO_FILL_SWEEPER=1)");
      return;
    }
    this.intervalHandle = setInterval(() => {
      this.tick().catch((err) => {
        this.log.error({ err }, "Auto-Fill-Sweeper tick failed");
      });
    }, TICK_INTERVAL_MS);
    // unref(): der Timer soll den Node-Prozess nicht am Beenden hindern, falls
    // die App z.B. wegen Container-SIGTERM herunterfährt.
    this.intervalHandle.unref?.();
    this.log.log({ intervalMs: TICK_INTERVAL_MS }, "Auto-Fill-Sweeper läuft");
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Sucht alle fälligen Tische und füllt sie auf. Returnt die Liste der
   * tatsächlich verarbeiteten Tisch-IDs — nützlich für Tests, um die
   * Auswirkung zu verifizieren.
   */
  async tick(now: Date = new Date()): Promise<string[]> {
    // Wir laden Kandidaten in einem schmalen Query: nur WAITING-Tische mit
    // gesetztem autoFillSeconds. Die `lastSeatChangeAt + autoFillSeconds`-
    // Bedingung lässt sich nicht in einer einzigen Prisma-Where-Clause
    // ausdrücken (variable Sekunden pro Tisch), also filtern wir clientseitig.
    const candidates = await this.prisma.lobbyTable.findMany({
      where: {
        status: LobbyTableStatus.WAITING,
        autoFillSeconds: { not: null },
      },
      select: {
        id: true,
        autoFillSeconds: true,
        lastSeatChangeAt: true,
        seats: { select: { seat: true } },
      },
    });

    const due = candidates.filter((t) => {
      if (t.seats.length >= 4) return false; // tryAutoStartGame() kümmert sich
      const dueAt = t.lastSeatChangeAt.getTime() + (t.autoFillSeconds ?? 0) * 1000;
      return dueAt <= now.getTime();
    });

    const processed: string[] = [];
    for (const t of due) {
      try {
        await this.lobby.autoFillAndStart(t.id);
        processed.push(t.id);
      } catch (err) {
        // Fehler pro Tisch isolieren — ein kaputter Tisch soll den Sweeper
        // nicht für alle anderen blockieren.
        this.log.warn({ tableId: t.id, err }, "Auto-Fill für Tisch fehlgeschlagen");
      }
    }
    if (processed.length > 0) {
      this.log.log({ count: processed.length }, "Auto-Fill ausgeführt");
    }
    return processed;
  }
}
