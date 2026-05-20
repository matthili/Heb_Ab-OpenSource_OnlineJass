/**
 * Inferenz-Microservice für Heb ab! — **Multi-Modell**.
 *
 * **Aufgabe**: Pro Spielart ein eigenes NN-Modell aus
 * `external/jass-nn/<gameType>/` laden und `POST /predict`-Anfragen
 * beantworten. Die Mask wird elementweise auf die Softmax-Policy
 * aufgeschlagen, sodass illegale Karten garantiert nicht empfohlen werden.
 *
 * **Spielarten** (seit der 3-Varianten-Integration):
 *   - `kreuz`    → Kreuz-Jass   (encoding 3.0.0, state 421)
 *   - `solo`     → Solo-Jass    (encoding 3.0.0, state 421)
 *   - `bodensee` → Bodensee-Jass (encoding bodensee_1.0.0, state 291)
 *
 * Welche Modelle beim Boot geladen werden, steuert `INFERENCE_GAME_TYPES`
 * (Komma-Liste, Default `kreuz,solo`). Bodensee wird erst aktiviert, wenn
 * sein TypeScript-Encoder fertig ist.
 *
 * **Lifecycle**: Modelle beim Start geladen, Encoding-Version pro Modell
 * gegen die erwartete Version geprüft (Hard-Error bei Mismatch). `/health`
 * ist die Liveness-Probe und listet alle geladenen Modelle.
 *
 * **Multi-Instance**: stateless — beliebig viele Repliken möglich.
 */
import { join } from "node:path";

import Fastify from "fastify";
import { pino } from "pino";
import * as tf from "@tensorflow/tfjs";

import { ACTION_DIM, ENCODING_VERSION, STATE_DIM } from "@jass/engine";
import { loadModel, manifestToMeta, type ModelMeta } from "./model-loader.js";

const DEFAULT_PORT = 4000;
const DEFAULT_MODEL_DIR = "../../external/jass-nn";
const DEFAULT_GAME_TYPES = "kreuz,solo";

/**
 * Pro Spielart die erwartete Encoding-Version + State-Dimension.
 * Kreuz + Solo teilen den 3.0.0-Encoder (421 dim). Bodensee hat einen
 * eigenen Encoder (291 dim) — kommt mit dem Phase-2-Sprint.
 */
const GAME_TYPE_SPEC: Record<string, { encoding: string; stateDim: number }> = {
  kreuz: { encoding: ENCODING_VERSION, stateDim: STATE_DIM },
  solo: { encoding: ENCODING_VERSION, stateDim: STATE_DIM },
  bodensee: { encoding: "bodensee_1.0.0", stateDim: 291 },
};

const isDev = process.env["NODE_ENV"] !== "production";
const pinoLevel = process.env["LOG_LEVEL"] ?? (isDev ? "debug" : "info");
const logger = isDev
  ? pino({
      level: pinoLevel,
      transport: {
        target: "pino-pretty",
        options: { singleLine: true, translateTime: "SYS:HH:MM:ss" },
      },
    })
  : pino({ level: pinoLevel });

// --- Modell-Registry (nach Boot belegt) -------------------------------------

interface LoadedEntry {
  model: tf.LayersModel;
  meta: ModelMeta;
  stateDim: number;
}

const registry = new Map<string, LoadedEntry>();

interface PredictRequestBody {
  /** Spielart — default "kreuz" (Backwards-Kompat für ältere Clients). */
  gameType?: string;
  state: number[];
  mask: number[];
}

interface PredictResponseBody {
  policy: number[];
  value: number;
  argmax: number;
  meta: ModelMeta;
}

// --- Predict-Pfad: pure compute, kein I/O nach dem Modell-Load -------------

function predict(gameType: string, state: number[], mask: number[]): PredictResponseBody {
  const entry = registry.get(gameType);
  if (!entry) {
    throw new Error(
      `Kein Modell für Spielart '${gameType}' geladen. Verfügbar: ${[...registry.keys()].join(", ")}`
    );
  }
  if (state.length !== entry.stateDim) {
    throw new Error(
      `state must have length ${entry.stateDim} for '${gameType}', got ${state.length}`
    );
  }
  if (mask.length !== ACTION_DIM) {
    throw new Error(`mask must have length ${ACTION_DIM}, got ${mask.length}`);
  }

  // Modell ist dual-input: state + mask. Die Custom-Layer `MaskBias` rechnet
  // intern `(1 - mask) * -1e9` und addiert das auf die Logits, sodass softmax
  // illegale Aktionen auf praktisch 0 zieht.
  const { policyArr, valueScalar } = tf.tidy(() => {
    const stateT = tf.tensor2d([state], [1, entry.stateDim]);
    const maskT = tf.tensor2d([mask], [1, ACTION_DIM]);
    const output = entry.model.predict([stateT, maskT]);
    let policyTensor: tf.Tensor;
    let valueTensor: tf.Tensor;
    if (Array.isArray(output)) {
      [policyTensor, valueTensor] = output as [tf.Tensor, tf.Tensor];
    } else {
      policyTensor = output as tf.Tensor;
      valueTensor = tf.scalar(0);
    }
    return {
      policyArr: Array.from(policyTensor.dataSync()),
      valueScalar: valueTensor.dataSync()[0] ?? 0,
    };
  });

  // Sicherheits-Argmax: Modell hat die Mask intern angewendet, wir prüfen
  // client-seitig nochmal, dass keine illegale Karte gewinnt.
  let argmax = 0;
  let argmaxScore = -Infinity;
  for (let i = 0; i < ACTION_DIM; i++) {
    if (mask[i] !== 1) continue;
    const p = policyArr[i] ?? 0;
    if (p > argmaxScore) {
      argmaxScore = p;
      argmax = i;
    }
  }
  if (argmaxScore === -Infinity) {
    throw new Error("predict: keine legale Aktion in mask gefunden");
  }

  return { policy: policyArr, value: valueScalar, argmax, meta: entry.meta };
}

// --- Fastify-Server ---------------------------------------------------------

async function main(): Promise<void> {
  logger.info({ tfjsVersion: tf.version.tfjs }, "Inferenz-Service startet");

  const baseDir = process.env["MODEL_DIR"] ?? DEFAULT_MODEL_DIR;
  const gameTypes = (process.env["INFERENCE_GAME_TYPES"] ?? DEFAULT_GAME_TYPES)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  logger.info({ baseDir, gameTypes }, "Lade Modelle");

  for (const gt of gameTypes) {
    const spec = GAME_TYPE_SPEC[gt];
    if (!spec) {
      throw new Error(
        `Unbekannte Spielart '${gt}' in INFERENCE_GAME_TYPES. ` +
          `Bekannt: ${Object.keys(GAME_TYPE_SPEC).join(", ")}`
      );
    }
    const modelDir = join(baseDir, gt);
    logger.info({ gameType: gt, modelDir }, "Lade Modell");
    const loaded = await loadModel(modelDir, spec.encoding);
    const meta = manifestToMeta(loaded.manifest);
    registry.set(gt, { model: loaded.model, meta, stateDim: spec.stateDim });
    logger.info({ gameType: gt, meta }, "Modell geladen");

    // Warm-up: ein dummy-Predict, damit der erste echte Request keine
    // tf-internen JIT-Kosten zahlt.
    const warmState = new Array<number>(spec.stateDim).fill(0);
    const warmMask = new Array<number>(ACTION_DIM).fill(1);
    predict(gt, warmState, warmMask);
    logger.debug({ gameType: gt }, "Warm-up-Predict ok");
  }

  if (registry.size === 0) {
    throw new Error("Kein einziges Modell geladen — INFERENCE_GAME_TYPES leer?");
  }

  const app = Fastify({ loggerInstance: logger });

  app.get("/health", () => ({
    status: "ok",
    ts: new Date().toISOString(),
    models: Object.fromEntries([...registry.entries()].map(([gt, e]) => [gt, e.meta])),
  }));

  app.post<{ Body: PredictRequestBody; Reply: PredictResponseBody | { error: string } }>(
    "/predict",
    async (req, reply) => {
      try {
        const { gameType, state, mask } = req.body;
        // gameType default "kreuz" — ältere Clients ohne das Feld treffen
        // weiterhin das Kreuz-Modell.
        const gt = gameType ?? "kreuz";
        if (!Array.isArray(state)) {
          reply.code(400);
          return { error: "state must be a number[]" };
        }
        if (!Array.isArray(mask)) {
          reply.code(400);
          return { error: "mask must be a number[] (required, dual-input model)" };
        }
        if (!registry.has(gt)) {
          reply.code(400);
          return {
            error: `Spielart '${gt}' nicht verfügbar. Geladen: ${[...registry.keys()].join(", ")}`,
          };
        }
        return predict(gt, state, mask);
      } catch (err) {
        reply.code(500);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  const port = Number.parseInt(process.env["INFERENCE_PORT"] ?? String(DEFAULT_PORT), 10);
  await app.listen({ port, host: "0.0.0.0" });
  logger.info(
    { port, models: [...registry.keys()] },
    `Inferenz bereit auf http://localhost:${port}`
  );
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Inferenz-Service Bootstrap failed");
  process.exit(1);
});
