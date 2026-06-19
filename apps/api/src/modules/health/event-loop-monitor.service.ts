/**
 * Event-Loop-Verzögerungs-Monitor.
 *
 * Misst, wie stark die Node-Event-Schleife (die Single-Thread-Warteschlange,
 * über die ALLE Requests laufen) hinterherhinkt. Liefert den jüngsten Mittelwert
 * an die `/health`-Probe — die meldet bei anhaltend hoher Verzögerung „degraded"
 * (503), worauf der Docker-Healthcheck + Autoheal den Container neustarten.
 *
 * **Abgrenzung**: Ein TOTALER Hänger (Loop komplett blockiert) wird ohnehin schon
 * erkannt — dann antwortet `/health` gar nicht und der HTTP-Healthcheck läuft in
 * den Timeout. Dieser Monitor deckt den Zwischenfall ab: Loop überlastet, aber
 * antwortet noch (zäh). Genau dort greift `restart:unless-stopped` nicht.
 *
 * **Eigener Sampler** (statt Auslesen direkt im Health-Handler): so ist das
 * Mess-Fenster (~5 s) unabhängig davon, wie oft `/health` gepingt wird. Bei
 * teilweiser Überlast läuft der Sampler (verzögert) weiter und erfasst den hohen
 * Mittelwert; das Histogramm wird von libuv unterhalb von JS geführt.
 */
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

const SAMPLE_INTERVAL_MS = 5_000;

@Injectable()
export class EventLoopMonitorService implements OnModuleInit, OnModuleDestroy {
  private histogram: IntervalHistogram | null = null;
  private sampleTimer: NodeJS.Timeout | null = null;
  private currentLagMs = 0;

  onModuleInit(): void {
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
    this.sampleTimer = setInterval(() => {
      const meanNs = this.histogram?.mean ?? 0;
      this.currentLagMs = Number.isFinite(meanNs) ? meanNs / 1_000_000 : 0;
      this.histogram?.reset();
    }, SAMPLE_INTERVAL_MS);
    // Der Timer soll den Prozess nicht am Beenden hindern (SIGTERM-Shutdown).
    this.sampleTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    this.histogram?.disable();
  }

  /** Mittlere Event-Loop-Verzögerung im jüngsten Messfenster, in Millisekunden. */
  currentLagMsValue(): number {
    return this.currentLagMs;
  }
}
