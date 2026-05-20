/**
 * HTTP-Client zum Inferenz-Microservice (`apps/inference`).
 *
 * **Verantwortlichkeit**: API-Seite — encoded Spielzustände an den
 * Inferenz-Service schicken, argmax + Metadaten zurückbekommen.
 *
 * **Fallback-Strategie**: bei jeder Art von Inferenz-Fehler
 * (Timeout, 5xx, Netzwerk, parse) wirft die `predict()`-Methode einen
 * `InferenceUnavailableError`. Der Aufrufer (NNInferencePlayer) entscheidet
 * dann, ob er auf RandomLegalMovePlayer fallback geht. So bleibt das Spiel
 * spielbar, selbst wenn der Inferenz-Container down/überlastet ist.
 *
 * **Timeout**: per AbortController, defaultmäßig 2 s. Production-Server
 * sollten <100 ms p95 liefern; 2 s ist großzügig, um intermittente
 * Latenz-Spikes nicht direkt in den Fallback zu schieben.
 */
import { Injectable, Logger } from "@nestjs/common";

export class InferenceUnavailableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "InferenceUnavailableError";
  }
}

export interface PredictRequest {
  /**
   * Spielart — bestimmt, welches Modell der Inferenz-Service nutzt.
   * Default `kreuz` (Backwards-Kompat). Mögliche Werte: `kreuz`, `solo`,
   * `bodensee`.
   */
  gameType?: "kreuz" | "solo" | "bodensee";
  state: readonly number[];
  mask: readonly number[];
}

export interface PredictResponse {
  policy: readonly number[];
  value: number;
  argmax: number;
  meta: {
    releaseVersion: string;
    specVersion: string;
    encodingVersion: string;
    teamMode?: string;
    gameMode?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_BASE_URL = "http://localhost:4000";

@Injectable()
export class InferenceClient {
  private readonly log = new Logger(InferenceClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = process.env["INFERENCE_URL"] ?? DEFAULT_BASE_URL;
    this.timeoutMs = Number.parseInt(
      process.env["INFERENCE_TIMEOUT_MS"] ?? String(DEFAULT_TIMEOUT_MS),
      10
    );
  }

  async predict(body: PredictRequest): Promise<PredictResponse> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameType: body.gameType ?? "kreuz",
          state: body.state,
          mask: body.mask,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "<no body>");
        throw new InferenceUnavailableError(
          `Inferenz-Service antwortete ${res.status}: ${text.slice(0, 200)}`
        );
      }
      const json = (await res.json()) as PredictResponse;
      if (typeof json.argmax !== "number" || !Array.isArray(json.policy)) {
        throw new InferenceUnavailableError("Antwort hat unerwartetes Schema");
      }
      return json;
    } catch (err) {
      if (err instanceof InferenceUnavailableError) throw err;
      // Netzwerk-Fehler, Timeout (AbortError), JSON-Parse — alles einheitlich
      // als "unavailable" behandeln.
      const isAbort = (err as { name?: string }).name === "AbortError";
      const message = isAbort
        ? `Inferenz-Timeout nach ${this.timeoutMs} ms`
        : `Inferenz-Aufruf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`;
      this.log.warn({ err, baseUrl: this.baseUrl }, message);
      throw new InferenceUnavailableError(message, err);
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Health-Probe für den Inferenz-Service — wird beim API-Start aufgerufen,
   * damit Konfig-Fehler (falsche URL, Container down) früh sichtbar werden.
   * Wirft nicht: gibt einfach `false` zurück und loggt.
   */
  async ping(): Promise<boolean> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }
}
