/**
 * Lädt das NN-Modell aus dem lokalen `external/jass-nn/tfjs/`-Verzeichnis
 * und stellt die Encoding-/Spec-Versionen aus dem MANIFEST.json bereit.
 *
 * Lade-Vertrag (siehe `docs/NN-CONTRACT.md`):
 *   1. MANIFEST.json einlesen, encoding_version + spec_version + release_version
 *      neben das Modell stellen.
 *   2. Wenn das App-erwartete `EXPECTED_ENCODING_VERSION` nicht mit dem
 *      MANIFEST übereinstimmt: **Fail fast** (Hard-Error beim Boot), keine
 *      Inferenz mit inkompatibler Vektor-Form.
 *   3. model.json + Weight-Shards selbst per `fs.readFile` einlesen und an
 *      `tf.io.fromMemory()` weitergeben. Wir nutzen NICHT `tf.loadLayersModel`
 *      mit `file://`-URL, weil Node.js' built-in `fetch` (undici) das
 *      `file:`-Schema nicht unterstützt — tfjs würde mit
 *      "fetch failed: not implemented... yet..." abbrechen.
 *
 * Aktuelles Modell (v0.5.0): Single-Input `state[batch,421]` → Multi-Output
 * `{ policy[batch,36] (Softmax), value[batch,1] }`. Die Mask ist NICHT Input
 * (state_encoding.md beschreibt einen Logits-Bias-Layer, das exportierte
 * Modell hat ihn nicht). Maske wird in `server.ts` clientseitig auf die
 * `policy` aufgeschlagen.
 */
import { readFile, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { join } from "node:path";

import * as tf from "@tensorflow/tfjs";
import { ENCODING_VERSION as EXPECTED_ENCODING_VERSION, SPEC_VERSION } from "@jass/engine";

// Explizite Wert-Referenz statt nur side-effect-Import: garantiert, dass die
// Registration-Statements in mask-bias-layer.ts vor `tf.loadLayersModel`
// laufen — und dass kein Tree-Shaker den Side-effect wegoptimiert.
import { MaskBias, registerCustomLayers } from "./mask-bias-layer.js";

const readFileAsync = promisify(readFile);

interface Manifest {
  release_version: string;
  spec_version: string;
  encoding_version: string;
  has_model: boolean;
}

interface ModelJson {
  modelTopology: unknown;
  format?: string;
  generatedBy?: string;
  convertedBy?: string;
  weightsManifest: Array<{
    paths: string[];
    weights: tf.io.WeightsManifestEntry[];
  }>;
}

export interface LoadedModel {
  model: tf.LayersModel;
  manifest: Manifest;
}

export interface ModelMeta {
  releaseVersion: string;
  specVersion: string;
  encodingVersion: string;
}

/**
 * Lädt Modell + MANIFEST aus `modelDir` (z.B. `external/jass-nn/`).
 * Wirft bei Encoding-Version-Mismatch oder fehlendem `tfjs/model.json`.
 */
export async function loadModel(modelDir: string): Promise<LoadedModel> {
  // Custom-Layer-Registration ist Pflicht VOR `tf.loadLayersModel` — sonst
  // hängt der Deserialisierer (Pure-JS-tfjs) auf der unbekannten Klasse.
  registerCustomLayers();
  void MaskBias; // hält den Import lebendig, falls bundler unsicher

  const manifest = readManifest(modelDir);
  if (manifest.encoding_version !== EXPECTED_ENCODING_VERSION) {
    throw new Error(
      `Encoding-Version-Mismatch: erwartet ${EXPECTED_ENCODING_VERSION}, ` +
        `MANIFEST.json sagt ${manifest.encoding_version}. ` +
        `App muss aktualisiert werden, oder das NN-Artefakt zurückgepinnt.`
    );
  }
  if (manifest.spec_version !== SPEC_VERSION) {
    // Spec-Version-Mismatch ist additiv-tolerant: das Modell könnte neue
    // Varianten kennen, die unsere Engine noch nicht spielt. Wir loggen,
    // brechen aber nicht.
    console.warn(
      `Spec-Version-Mismatch (additiv): App ${SPEC_VERSION}, MANIFEST ${manifest.spec_version}`
    );
  }

  const tfjsDir = join(modelDir, "tfjs");
  const modelJsonRaw = await readFileAsync(join(tfjsDir, "model.json"), "utf8");
  const modelJson = JSON.parse(modelJsonRaw) as ModelJson;

  // Keras-3-Export ist nicht direkt tfjs-kompatibel. Wir patchen das JSON,
  // bevor wir es an tf übergeben:
  //   1. `batch_shape` → `batch_input_shape` (Keras-2-Naming)
  //   2. `inbound_nodes: [{args:[...], kwargs:{...}}]`
  //      → `inbound_nodes: [[[layer, ni, ti, kwargs], ...]]`
  //   3. `kwargs.mask === null` rauswerfen (Softmax wirft sonst)
  // Sobald der NN-Build mit Keras 2 (oder einem Keras-3-tfjs-Patch im Converter)
  // exportiert, kann diese Funktion entfernt werden.
  normalizeKeras3ToKeras2(modelJson.modelTopology);

  // Alle Weight-Shards lesen und zu einem ArrayBuffer zusammenfügen.
  // tf.io.fromMemory akzeptiert das als `weightData` direkt.
  const groupArrays: ArrayBuffer[] = [];
  const weightSpecs: tf.io.WeightsManifestEntry[] = [];
  for (const group of modelJson.weightsManifest) {
    for (const path of group.paths) {
      const buf = await readFileAsync(join(tfjsDir, path));
      // Kopie auf einen frischen ArrayBuffer, damit der Slice nicht den
      // ganzen Node-Buffer-Pool festhält.
      const ab = new ArrayBuffer(buf.byteLength);
      new Uint8Array(ab).set(buf);
      groupArrays.push(ab);
    }
    weightSpecs.push(...group.weights);
  }
  const totalBytes = groupArrays.reduce((sum, ab) => sum + ab.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const ab of groupArrays) {
    combined.set(new Uint8Array(ab), offset);
    offset += ab.byteLength;
  }

  const artifacts: tf.io.ModelArtifacts = {
    modelTopology: modelJson.modelTopology as Exclude<
      tf.io.ModelArtifacts["modelTopology"],
      undefined
    >,
    weightSpecs,
    weightData: combined.buffer,
    ...(modelJson.format !== undefined ? { format: modelJson.format } : {}),
    ...(modelJson.generatedBy !== undefined ? { generatedBy: modelJson.generatedBy } : {}),
    ...(modelJson.convertedBy !== undefined ? { convertedBy: modelJson.convertedBy } : {}),
  };
  // Optional: gepatchte Topology zum Debuggen ins Dateisystem dumpen.
  if (process.env["DEBUG_DUMP_PATCHED_TOPOLOGY"]) {
    const path = process.env["DEBUG_DUMP_PATCHED_TOPOLOGY"];
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify(modelJson.modelTopology, null, 2));
  }

  // Sicherheits-Check: MaskBias muss in der Serialisierungs-Map vorhanden sein,
  // bevor tf.loadLayersModel den Layer-Graph deserialisiert. Sonst hängt der
  // Loader im Pure-JS-Backend ohne Fehler.
  const registry = tf.serialization.SerializationMap.getMap().classNameMap as Record<
    string,
    unknown
  >;
  if (!Object.keys(registry).some((n) => n.includes("MaskBias"))) {
    throw new Error(
      "Custom-Layer `jass>MaskBias` ist nicht in tf.serialization registriert. " +
        "Stelle sicher, dass `registerCustomLayers()` aufgerufen wird."
    );
  }

  const handler = tf.io.fromMemory(artifacts);
  const model = await tf.loadLayersModel(handler);
  return { model, manifest };
}

export function readManifest(modelDir: string): Manifest {
  const raw = readFileSync(join(modelDir, "MANIFEST.json"), "utf8");
  return JSON.parse(raw) as Manifest;
}

export function manifestToMeta(m: Manifest): ModelMeta {
  return {
    releaseVersion: m.release_version,
    specVersion: m.spec_version,
    encodingVersion: m.encoding_version,
  };
}

/**
 * Patcht Keras-3-spezifisches JSON-Schema rekursiv ins Keras-2-/tfjs-Schema.
 *
 * Behandelt vier bekannte Inkompatibilitäten zwischen
 *   - Keras 3.x + tensorflowjs_converter v4.x  (was wir vom NN-Repo bekommen)
 *   - tfjs-layers v4.x  (was wir hier laden müssen)
 *
 * **1. `batch_shape` → `batch_input_shape`** (InputLayer)
 *     tfjs-layers wirft sonst: "An InputLayer should be passed either a
 *     `batchInputShape` or an `inputShape`."
 *
 * **2. `inbound_nodes`-Format**  (auf jedem Layer mit mindestens 1 Input)
 *     Keras 3 (Standard, Single-Input): `[{args: [tensor], kwargs: {...}}]`
 *     Keras 3 (Multi-Input wie Add):    `[{args: [[tensor1, tensor2]], kwargs}]`
 *     Keras 3 (Form B, selten):         `[[tensor1, tensor2, ...]]`
 *     Keras 2 (Ziel):                   `[[[name, ni, ti, kwargs], ...]]`
 *     tfjs-layers wirft sonst je nach Fall: "Corrupted configuration, expected
 *     array for nodeData" oder hängt still beim Deserialize.
 *
 * **3. `kwargs.mask: null`** (Softmax)
 *     Tfjs stolpert über `null` als Mask-Argument. Wir löschen das Feld, sodass
 *     Softmax seinen Default nutzt.
 *
 * **4. `input_layers` / `output_layers` Object → Array**
 *     Keras 3 schreibt diese als benannte Maps; Keras 2 / tfjs-Container
 *     erwartet Arrays von Tuples. Andernfalls: "Object is not iterable."
 *
 * Wir mutieren in-place — das modelJson lebt sowieso nur kurz im Loader-Scope.
 *
 * Sobald der NN-Build mit Keras 2 (oder einem Keras-3-tfjs-Patch im Converter)
 * exportiert, kann diese Funktion entfernt werden. Bis dahin meldet
 * `tf.loadLayersModel` auf Pure-JS-tfjs ohne diesen Patch entweder einen
 * Validierungsfehler oder hängt still.
 */
function normalizeKeras3ToKeras2(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) normalizeKeras3ToKeras2(item);
    return;
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;

    // (1) batch_shape → batch_input_shape, gilt für InputLayer-Configs
    if (
      obj["class_name"] === "InputLayer" &&
      typeof obj["config"] === "object" &&
      obj["config"] !== null
    ) {
      const cfg = obj["config"] as Record<string, unknown>;
      if (cfg["batch_shape"] !== undefined && cfg["batch_input_shape"] === undefined) {
        cfg["batch_input_shape"] = cfg["batch_shape"];
        delete cfg["batch_shape"];
      }
    }

    // (2) inbound_nodes-Konvertierung Keras 3 → Keras 2.
    // Wichtig: nur konvertieren, wenn das hier *ein Layer-Eintrag* ist — also
    // ein Objekt mit `name` + `class_name`. Sonst kollidiert die Konvertierung
    // mit gleichnamigen Schlüsseln tiefer im Graphen.
    if (
      "inbound_nodes" in obj &&
      typeof obj["class_name"] === "string" &&
      typeof obj["name"] === "string"
    ) {
      obj["inbound_nodes"] = convertInboundNodes(obj["inbound_nodes"]);
    }

    // (4) input_layers / output_layers Object → Array of Tuples
    //     Keras 3: { "state": ["state", 0, 0], "mask": ["mask", 0, 0] }
    //     Keras 2: [ ["state", 0, 0], ["mask", 0, 0] ]
    //     Container.fromConfig erwartet iterable — bekommt sonst
    //     "Object is not iterable".
    for (const key of ["input_layers", "output_layers"]) {
      const v = obj[key];
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        obj[key] = Object.values(v as Record<string, unknown>);
      }
    }

    // KEINE Weiter-Rekursion in `inbound_nodes`, sonst werden die gerade
    // konvertierten `[name, ni, ti, kwargs]`-Tupel wieder traversiert und
    // potenziell remangelt (z.B. wenn name="kwargs" als Objekt-Key auftauchen
    // würde). Alle anderen Keys werden normal rekursiert.
    for (const key of Object.keys(obj)) {
      if (key === "inbound_nodes") continue;
      normalizeKeras3ToKeras2(obj[key]);
    }
  }
}

/**
 * Wandelt das Keras-3-Inbound-Nodes-Format zum Keras-2-Array-Format.
 *
 * Keras 3 nutzt zwei Schreibweisen für `inbound_nodes`:
 *   Form A (Standard, Single- und Multi-Input über `args`):
 *     `[{args: [tensor, tensor, ...], kwargs: {...}}]`
 *   Form B (Multi-Input-Layer wie `Add`, kein args-Wrapper):
 *     `[[tensor, tensor, ...]]`
 *
 * Keras 2 / tfjs erwartet:
 *     `[[[name, ni, ti, kwargs], [name, ni, ti, kwargs], ...]]`
 *
 * Wir erkennen ein noch-nicht-konvertiertes Element daran, dass es entweder
 * ein Objekt mit `args` ist (Form A), oder ein Array, dessen erstes Element
 * ein Tensor-Objekt mit `class_name === "__keras_tensor__"` ist (Form B).
 * Inputs (leeres Array) werden unverändert durchgereicht.
 */
function convertInboundNodes(ibn: unknown): unknown {
  if (!Array.isArray(ibn) || ibn.length === 0) return ibn;
  return ibn.map((node) => convertSingleCall(node));
}

function convertSingleCall(node: unknown): unknown {
  // Form A: `{ args: [...], kwargs: {...} }` (Keras 3 Standard).
  //   args ist meistens ein 1-elementiges Array mit dem Input-Tensor; für
  //   Multi-Input-Layer (Add, Concatenate, …) ist args ein 1-elementiges
  //   Array, dessen Element ein Array von Tensoren ist (`args: [[t1, t2]]`).
  //   Wir flachen den verschachtelten Fall auf, sodass jedes Tensor-Objekt
  //   ein Argument wird.
  if (typeof node === "object" && node !== null && !Array.isArray(node)) {
    const n = node as { args?: unknown[]; kwargs?: Record<string, unknown> };
    if (Array.isArray(n.args)) {
      const kwargs = sanitizeKwargs(n.kwargs);
      const flat: unknown[] = [];
      for (const arg of n.args) {
        if (Array.isArray(arg)) {
          for (const inner of arg) flat.push(inner);
        } else {
          flat.push(arg);
        }
      }
      return flat.map((arg) => kerasTensorToInbound(arg, kwargs));
    }
    return node;
  }
  // Form B: `[tensor, tensor, ...]` (Keras 3 ohne args-Wrapper, selten)
  if (Array.isArray(node) && node.length > 0 && isKerasTensor(node[0])) {
    return node.map((arg) => kerasTensorToInbound(arg, {}));
  }
  // Bereits konvertiert (Keras 2): Array von [name, ni, ti, kwargs] → durchreichen.
  return node;
}

function sanitizeKwargs(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const kwargs: Record<string, unknown> = { ...(input ?? {}) };
  // tfjs stolpert über `mask: null` (z.B. an Softmax). Default ist eh kein Mask.
  if (kwargs["mask"] === null) delete kwargs["mask"];
  return kwargs;
}

function isKerasTensor(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { class_name?: unknown }).class_name === "__keras_tensor__"
  );
}

function kerasTensorToInbound(arg: unknown, kwargs: Record<string, unknown>): unknown {
  if (!isKerasTensor(arg)) return arg;
  const hist = (arg as { config?: { keras_history?: unknown[] } }).config?.keras_history;
  if (!Array.isArray(hist) || hist.length < 3) return arg;
  return [hist[0], hist[1], hist[2], kwargs];
}
