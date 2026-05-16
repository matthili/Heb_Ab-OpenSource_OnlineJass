/**
 * Inferenz-Microservice für Heb ab!
 *
 * **Aufgabe**: Modell-NN aus `external/jass-nn/` laden, eingehende
 * `POST /predict { state[421], mask[36] }`-Anfragen mit
 * `{ policy[36], value, argmax }` beantworten. Mask wird vom Server
 * elementweise auf die Softmax-Policy multipliziert und für den argmax
 * verwendet, sodass illegale Karten garantiert nicht vom Modell empfohlen
 * werden.
 *
 * **Lifecycle**: Modell beim Start geladen, Encoding-Version gegen
 * `@jass/engine` geprüft (Hard-Error bei Mismatch). `/health` ist die
 * Liveness-Probe und enthält Versions-Metadaten zum Debugging.
 *
 * **Multi-Instance**: dieses Binary ist stateless — beliebig viele Repliken
 * möglich; Load-Balancer-Decisions trifft Caddy/k8s-Ingress.
 *
 * **Backend**: nutzt `@tensorflow/tfjs` (Pure-JS, CPU). Für Production-Speed
 * kann später auf `@tensorflow/tfjs-node` (NAPI) gewechselt werden — die
 * tf-API bleibt identisch. Aktuell macht ein Predict ≈ 1-5 ms.
 */
import Fastify from "fastify";
import { pino } from "pino";
import * as tf from "@tensorflow/tfjs";

import { ACTION_DIM, STATE_DIM } from "@jass/engine";
import { loadModel, manifestToMeta, type ModelMeta } from "./model-loader.js";

const DEFAULT_PORT = 4000;
const DEFAULT_MODEL_DIR = "../../external/jass-nn";

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

// --- Globaler Modell-Holder (nach Boot belegt) ------------------------------

let model: tf.LayersModel | null = null;
let meta: ModelMeta | null = null;

interface PredictRequestBody {
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

function predict(state: number[], mask: number[]): PredictResponseBody {
  if (!model || !meta) {
    throw new Error("Model not loaded yet");
  }
  if (state.length !== STATE_DIM) {
    throw new Error(`state must have length ${STATE_DIM}, got ${state.length}`);
  }
  if (mask.length !== ACTION_DIM) {
    throw new Error(`mask must have length ${ACTION_DIM}, got ${mask.length}`);
  }

  // Modell ist dual-input: state + mask. Die Custom-Layer `MaskBias` rechnet
  // intern `(1 - mask) * -1e9` und addiert das auf die Logits, sodass softmax
  // illegale Aktionen auf praktisch 0 zieht. Wir geben hier beide Tensoren
  // in der Reihenfolge des `input_layers` aus model.json (state, mask).
  const { policyArr, valueScalar } = tf.tidy(() => {
    const stateT = tf.tensor2d([state], [1, STATE_DIM]);
    const maskT = tf.tensor2d([mask], [1, ACTION_DIM]);
    const output = model!.predict([stateT, maskT]);
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

  // Sicherheits-Argmax: Das Modell hat die Mask intern schon angewendet,
  // aber wir prüfen client-seitig nochmal, dass kein Fließkomma-Wackler
  // einer illegalen Karte einen Hauch von Wahrscheinlichkeit gibt.
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

  return {
    policy: policyArr,
    value: valueScalar,
    argmax,
    meta,
  };
}

// --- Fastify-Server ---------------------------------------------------------

async function main(): Promise<void> {
  logger.info({ tfjsVersion: tf.version.tfjs }, "Inferenz-Service startet");

  const modelDir = process.env["MODEL_DIR"] ?? DEFAULT_MODEL_DIR;
  logger.info({ modelDir }, "Lade Modell + MANIFEST");
  const loaded = await loadModel(modelDir);
  model = loaded.model;
  meta = manifestToMeta(loaded.manifest);
  logger.info({ meta }, "Modell geladen");

  // Warm-up: ein dummy-Predict, damit der erste echte Request keine
  // tf-internen JIT-Kosten zahlt. State+Mask sind alles erlaubt.
  const warmState = new Array<number>(STATE_DIM).fill(0);
  const warmMask = new Array<number>(ACTION_DIM).fill(1);
  predict(warmState, warmMask);
  logger.debug("Warm-up-Predict ok");

  const app = Fastify({ loggerInstance: logger });

  app.get("/health", () => ({ status: "ok", ts: new Date().toISOString(), meta }));

  app.post<{ Body: PredictRequestBody; Reply: PredictResponseBody | { error: string } }>(
    "/predict",
    async (req, reply) => {
      try {
        const { state, mask } = req.body;
        if (!Array.isArray(state)) {
          reply.code(400);
          return { error: "state must be a number[]" };
        }
        if (!Array.isArray(mask)) {
          reply.code(400);
          return { error: "mask must be a number[] (required, dual-input model)" };
        }
        return predict(state, mask);
      } catch (err) {
        reply.code(500);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  const port = Number.parseInt(process.env["INFERENCE_PORT"] ?? String(DEFAULT_PORT), 10);
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, `Inferenz bereit auf http://localhost:${port}`);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Inferenz-Service Bootstrap failed");
  process.exit(1);
});
