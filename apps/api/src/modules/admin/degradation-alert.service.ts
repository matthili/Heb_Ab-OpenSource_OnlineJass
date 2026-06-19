/**
 * Granulare Ausfall-Alarmierung (in-process).
 *
 * Ergänzt den externen Uptime-Watchdog (infra/watchdog), der nur „API
 * komplett erreichbar/nicht" abdeckt. Dieser Dienst läuft IN der API und
 * meldet den degradierten Zwischenfall: die API läuft, aber eine Abhängigkeit
 * ist weg — konkret **Inferenz-Engine, SMTP, Landing-Site**. (DB-/Redis-
 * Totalausfall heißt i.d.R. ohnehin „API down" → das deckt der externe
 * Watchdog ab; hier doppeln wir es nicht.)
 *
 * Es wird nur bei einem Zustands-WECHSEL gemailt (ok→down und down→ok) — kein
 * Dauer-Spam. Empfänger ist dieselbe `WATCHDOG_ALERT_EMAIL` wie beim externen
 * Watchdog. Ohne gesetzte Adresse wird nur geloggt.
 *
 * Henne-Ei: Ist SMTP selbst der Ausfall, kann die SMTP-down-Mail natürlich
 * nicht raus (→ nur Log); die spätere „wieder ok"-Mail kommt dann an.
 *
 * Lifecycle/Skalierung wie die übrigen Sweeper (setInterval + unref,
 * DISABLE_DEGRADATION_ALERTS=1 zum Abschalten, Single-Instance).
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { MailService } from "../mail/mail.service.js";
import { SystemStatusService, type SystemStatus } from "./system-status.service.js";

/** Komponente → ist sie gerade ausgefallen? */
export type ComponentDownMap = Record<string, boolean>;

export interface ComponentTransition {
  component: string;
  down: boolean;
}

const LABELS: Record<string, string> = {
  inference: "KI-Inferenz-Engine",
  smtp: "SMTP (Mail-Versand)",
  landing: "Landing-Site",
};

const DEFAULT_INTERVAL_SECONDS = 120;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Leitet aus dem System-Status ab, welche der überwachten Komponenten gerade
 * ausgefallen sind. Nur „API-läuft-aber-degradiert"-Komponenten; SMTP nur bei
 * E-Mail-Aktivierung relevant, Landing nur wenn konfiguriert. Reine Funktion.
 */
export function toComponentDownMap(s: SystemStatus): ComponentDownMap {
  const map: ComponentDownMap = { inference: !s.inference.available };
  if (s.mode.accountActivation === "email") map["smtp"] = !s.smtp.ok;
  if (s.landing.ok !== null) map["landing"] = !s.landing.ok;
  return map;
}

/**
 * Zustands-Wechsel gegenüber dem vorigen Lauf. Beim ersten Lauf (`prev` null)
 * wird nur ein bereits ausgefallener Zustand gemeldet (nicht „alles ok").
 * Reine Funktion, für Unit-Tests exportiert.
 */
export function diffComponentStates(
  prev: ComponentDownMap | null,
  curr: ComponentDownMap
): ComponentTransition[] {
  const out: ComponentTransition[] = [];
  for (const [component, down] of Object.entries(curr)) {
    const was = prev?.[component];
    if (was === undefined) {
      if (down) out.push({ component, down: true });
    } else if (was !== down) {
      out.push({ component, down });
    }
  }
  return out;
}

@Injectable()
export class DegradationAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DegradationAlertService.name);
  private intervalHandle: NodeJS.Timeout | null = null;
  private prev: ComponentDownMap | null = null;
  private readonly intervalMs =
    readPositiveInt(process.env["DEGRADATION_ALERT_INTERVAL_SECONDS"], DEFAULT_INTERVAL_SECONDS) *
    1000;

  constructor(
    private readonly systemStatus: SystemStatusService,
    private readonly mail: MailService
  ) {}

  onModuleInit(): void {
    if (process.env["DISABLE_DEGRADATION_ALERTS"] === "1") {
      this.log.log("Degradations-Alarmierung deaktiviert (DISABLE_DEGRADATION_ALERTS=1)");
      return;
    }
    this.intervalHandle = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, "Degradations-Check fehlgeschlagen"));
    }, this.intervalMs);
    this.intervalHandle.unref?.();
    this.log.log({ intervalMs: this.intervalMs }, "Degradations-Alarmierung läuft");
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Ein Check: System-Status holen, Komponenten-Zustand mit dem vorigen Lauf
   * vergleichen, bei Wechseln alarmieren. Public + returnt die Wechsel (Tests).
   */
  async tick(): Promise<ComponentTransition[]> {
    const status = await this.systemStatus.getStatus();
    const curr = toComponentDownMap(status);
    const transitions = diffComponentStates(this.prev, curr);
    this.prev = curr;
    for (const t of transitions) {
      await this.alert(t);
    }
    return transitions;
  }

  private async alert(t: ComponentTransition): Promise<void> {
    const label = LABELS[t.component] ?? t.component;
    if (t.down) {
      this.log.error({ component: t.component }, `Komponente ausgefallen: ${label}`);
    } else {
      this.log.warn({ component: t.component }, `Komponente wieder erreichbar: ${label}`);
    }

    const to = process.env["WATCHDOG_ALERT_EMAIL"];
    if (!to) return;
    const subject = t.down
      ? `🚨 Heb ab!: ${label} ausgefallen`
      : `✅ Heb ab!: ${label} wieder erreichbar`;
    const body = t.down
      ? `Die Komponente „${label}" ist ausgefallen.\nZeit: ${new Date().toISOString()}\n\n` +
        `Die App läuft weiter; betroffen ist nur diese Funktion. Bitte prüfen.`
      : `Die Komponente „${label}" ist wieder erreichbar.\nZeit: ${new Date().toISOString()}`;
    try {
      await this.mail.send({
        to,
        subject,
        text: body,
        html: `<pre style="font-family:system-ui,sans-serif">${body}</pre>`,
      });
    } catch (err) {
      this.log.warn({ err, component: t.component }, "Degradations-Alarm-Mail fehlgeschlagen");
    }
  }
}
