/**
 * Watchdog für hängende Partien (Selbstheilung).
 *
 * Periodischer Sweep: laufende Partien (`Game.endedAt = null`) an einem
 * IN_GAME-Tisch, die seit `GAME_WATCHDOG_STUCK_MINUTES` keinen Fortschritt
 * mehr hatten (jüngster `Move.ts`, ersatzweise `startedAt`), werden über den
 * `resume`-Hook wieder angetrieben.
 *
 * **Warum gefahrlos?** Der Hook führt durch denselben Game-Lock dieselbe
 * KI-Antriebs-Schleife aus wie ein normaler Zug — und die ist idempotent:
 * ist ein Mensch am Zug oder das Spiel vorbei, passiert nichts. Ein
 * fälschlich „hängend" eingestuftes Spiel (z.B. ein lange grübelnder Mensch)
 * kostet also nur einen No-op durch den Lock. Echte Hänger (eine KI ist dran,
 * aber die Antriebs-Schleife wurde nie/abgebrochen geplant) laufen wieder an.
 *
 * **Architektur**: Dieser Service kennt das Gateway NICHT (keine Import-
 * Zyklen / ESM-TDZ). Das Gateway besitzt die Antriebs-Loops + den Lock und
 * meldet sich via `setHooks()` an — analog zum DisconnectVoteService.
 *
 * **Lifecycle**: `setInterval` im OnModuleInit, `clearInterval` im
 * OnModuleDestroy. Per `DISABLE_GAME_WATCHDOG=1` abschaltbar (Tests).
 *
 * **Skalierung**: Single-Instance (wie die übrigen Sweeper). Bei Multi-
 * Instance bräuchte es einen verteilten Lock pro Sweep.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { LobbyTableStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";

/** Vom Gateway bereitgestellt: treibt eine hängende Partie wieder an. */
export interface StuckGameHooks {
  resume(gameId: string, variant: string): Promise<void>;
}

/** Fortschritts-Sicht einer Partie — DB-frei, für die reine Auswahl-Funktion. */
export interface GameProgress {
  id: string;
  variant: string;
  startedAt: Date;
  /** Zeitpunkt des jüngsten Zugs; null = noch kein Zug gespielt. */
  lastMoveAt: Date | null;
}

const DEFAULT_STUCK_MINUTES = 5;
const DEFAULT_INTERVAL_SECONDS = 60;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Wählt aus laufenden Partien die hängenden: kein Fortschritt (jüngster Zug,
 * ersatzweise Spielstart) seit dem `cutoff`. Reine Funktion, für Unit-Tests
 * exportiert.
 */
export function pickStuckGameIds(games: readonly GameProgress[], cutoff: Date): string[] {
  const cut = cutoff.getTime();
  return games.filter((g) => (g.lastMoveAt ?? g.startedAt).getTime() < cut).map((g) => g.id);
}

@Injectable()
export class StuckGameWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StuckGameWatchdogService.name);
  private intervalHandle: NodeJS.Timeout | null = null;
  private hooks: StuckGameHooks | null = null;

  private readonly stuckMs =
    readPositiveInt(process.env["GAME_WATCHDOG_STUCK_MINUTES"], DEFAULT_STUCK_MINUTES) * 60_000;
  private readonly intervalMs =
    readPositiveInt(process.env["GAME_WATCHDOG_INTERVAL_SECONDS"], DEFAULT_INTERVAL_SECONDS) * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /** Vom Gateway gesetzt — es besitzt die KI-Antriebs-Loops + den Game-Lock. */
  setHooks(hooks: StuckGameHooks): void {
    this.hooks = hooks;
  }

  onModuleInit(): void {
    if (process.env["DISABLE_GAME_WATCHDOG"] === "1") {
      this.log.log("Spiel-Watchdog deaktiviert (DISABLE_GAME_WATCHDOG=1)");
      return;
    }
    this.intervalHandle = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, "Spiel-Watchdog-Tick fehlgeschlagen"));
    }, this.intervalMs);
    this.intervalHandle.unref?.();
    this.log.log({ intervalMs: this.intervalMs, stuckMs: this.stuckMs }, "Spiel-Watchdog läuft");
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Ein Sweep. Findet laufende Partien ohne Fortschritt seit `stuckMs` und
   * treibt deren KI über den `resume`-Hook wieder an. Public für Tests;
   * returnt die Game-IDs, die behandelt wurden.
   */
  async tick(now: Date = new Date()): Promise<string[]> {
    const cutoff = new Date(now.getTime() - this.stuckMs);
    const candidates = await this.prisma.game.findMany({
      where: { endedAt: null, table: { status: LobbyTableStatus.IN_GAME } },
      select: {
        id: true,
        variant: true,
        startedAt: true,
        moves: { select: { ts: true }, orderBy: { ts: "desc" }, take: 1 },
      },
    });
    const progress: GameProgress[] = candidates.map((g) => ({
      id: g.id,
      variant: g.variant,
      startedAt: g.startedAt,
      lastMoveAt: g.moves[0]?.ts ?? null,
    }));
    const variantById = new Map(progress.map((p) => [p.id, p.variant]));
    const stuckIds = pickStuckGameIds(progress, cutoff);

    const resumed: string[] = [];
    for (const id of stuckIds) {
      try {
        await this.hooks?.resume(id, variantById.get(id) ?? "KREUZ_4P");
        resumed.push(id);
      } catch (err) {
        this.log.warn({ gameId: id, err }, "Antrieb der hängenden Partie fehlgeschlagen");
      }
    }
    if (resumed.length > 0) {
      this.log.warn(
        { count: resumed.length, gameIds: resumed },
        "Hängende Partie(n) wieder angetrieben"
      );
    }
    return resumed;
  }
}
