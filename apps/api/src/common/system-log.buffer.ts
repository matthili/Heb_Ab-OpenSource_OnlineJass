/**
 * In-Memory-Ringpuffer der letzten WARN/ERROR/FATAL-Logzeilen — Quelle für den
 * Admin-„System-Log"-Tab. Bewusst flüchtig (kein DB-Schreiben pro Logzeile):
 * ein schneller Blick „was ist gerade schiefgelaufen", nicht ein Audit-Trail.
 * Nach einem Neustart ist er leer; der persistente Verlauf bleibt der Audit-Log.
 *
 * **Befüllung**: Wir hängen über `pino.multistream` einen zusätzlichen Stream
 * an den Logger (siehe `app.module.ts`). Multistream schreibt JEDE Logzeile als
 * rohes JSON an alle Ziele; unser Ziel filtert per `level: "warn"` und parst die
 * Zeile in einen kompakten Eintrag. Das muss IN-PROCESS passieren — ein
 * pino-`transport` läuft in einem Worker-Thread und käme an diesen Puffer nicht
 * heran.
 */
import { Writable } from "node:stream";

export interface SystemLogEntry {
  /** Epoch-Millis (aus dem pino-`time`-Feld). */
  time: number;
  /** Pino-Zahlen-Level: 40=warn, 50=error, 60=fatal. */
  level: number;
  /** Lesbares Label fürs Frontend. */
  levelLabel: "warn" | "error" | "fatal" | string;
  msg: string;
  /** nestjs-pino-Kontext (z.B. Klassenname), falls vorhanden. */
  context?: string;
  /** Fehler-Details bei `logger.error(err, ...)`. */
  err?: { type?: string; message?: string; stack?: string };
}

const CAPACITY = 500;
const LEVEL_LABEL: Record<number, SystemLogEntry["levelLabel"]> = {
  40: "warn",
  50: "error",
  60: "fatal",
};

class SystemLogBuffer {
  private readonly buf: SystemLogEntry[] = [];

  push(entry: SystemLogEntry): void {
    this.buf.push(entry);
    // Ältestes verwerfen, sobald wir die Kapazität überschreiten (FIFO-Ring).
    if (this.buf.length > CAPACITY) this.buf.shift();
  }

  /** Neueste zuerst — so will man einen Fehler-Log lesen. */
  list(): SystemLogEntry[] {
    return this.buf.slice().reverse();
  }

  clear(): void {
    this.buf.length = 0;
  }
}

/** Modul-Singleton: derselbe Puffer für den pino-Stream UND den AdminService. */
export const systemLogBuffer = new SystemLogBuffer();
export type { SystemLogBuffer };

/**
 * Writable für `pino.multistream`. Bekommt rohe pino-JSON-Zeilen (durch das
 * `level: "warn"`-Filter nur WARN+), parst sie defensiv und legt einen
 * kompakten Eintrag im Ringpuffer ab. Wirft nie — ein kaputter Logeintrag darf
 * den Logger-Stream nicht abreißen lassen.
 */
export function createSystemLogStream(): Writable {
  return new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line) as Record<string, unknown>;
          const level = typeof o["level"] === "number" ? (o["level"] as number) : 0;
          if (level < 40) continue;
          const entry: SystemLogEntry = {
            time: typeof o["time"] === "number" ? (o["time"] as number) : Date.now(),
            level,
            levelLabel: LEVEL_LABEL[level] ?? String(level),
            msg: typeof o["msg"] === "string" ? (o["msg"] as string) : "",
          };
          // Optionale Felder nur setzen, wenn vorhanden (exactOptionalPropertyTypes).
          if (typeof o["context"] === "string") entry.context = o["context"];
          const rawErr = o["err"] as
            | { type?: string; message?: string; stack?: string }
            | undefined;
          if (rawErr) entry.err = rawErr;
          systemLogBuffer.push(entry);
        } catch {
          // Keine valide JSON-Zeile — ignorieren (sollte mit pino nie vorkommen).
        }
      }
      cb();
    },
  });
}
