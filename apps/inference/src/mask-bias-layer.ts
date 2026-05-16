/**
 * TS-Implementation der Python-Custom-Layer `jass>MaskBias`.
 *
 * Logik (siehe state_encoding.md §"Aktionsmaske"):
 *   bias = (1.0 - mask) * -1e9
 *
 * Dieser Bias wird im Modell mit `Add` auf die rohen Logits aufaddiert,
 * sodass `softmax(logits + bias)` für illegale Aktionen praktisch 0 liefert.
 *
 * Im Python-Code des NN-Repos ist die Klasse mit
 * `@tf.keras.utils.register_keras_serializable(package="jass")` registriert,
 * deshalb der Class-Name `jass>MaskBias`. Wir registrieren uns hier mit
 * exakt diesem Namen, damit `tf.loadLayersModel` ihn beim Deserialisieren
 * findet.
 *
 * **Registrierungs-Pflicht:** `registerCustomLayers()` muss explizit
 * aufgerufen werden, BEVOR `tf.loadLayersModel` läuft. Ein reiner
 * Side-effect-Import (`import "./mask-bias-layer.js"`) ist nicht
 * verlässlich genug — Tree-Shaker können den entfernen, und im Pure-JS-tfjs
 * führt eine fehlende Registration zu einem stillen Deadlock beim
 * Deserialisieren (kein Error, der Loader hängt für immer).
 */
import * as tf from "@tensorflow/tfjs";

export class MaskBias extends tf.layers.Layer {
  static readonly className = "jass>MaskBias";

  override call(inputs: tf.Tensor | tf.Tensor[]): tf.Tensor | tf.Tensor[] {
    return tf.tidy(() => {
      const mask = Array.isArray(inputs) ? (inputs[0] as tf.Tensor) : inputs;
      const one = tf.scalar(1);
      const negInf = tf.scalar(-1e9);
      return tf.mul(tf.sub(one, mask), negInf);
    });
  }

  override computeOutputShape(inputShape: tf.Shape | tf.Shape[]): tf.Shape | tf.Shape[] {
    // shape-preserving: derselbe Tensor-Rang wie der Mask-Input.
    return inputShape;
  }

  override getClassName(): string {
    return MaskBias.className;
  }
}

let registered = false;

/**
 * Idempotent — sicheres Mehrfach-Aufrufen. Warum nicht einfach beim Modul-Load
 * registrieren? Weil ein Side-effect-Import bei Pure-JS-tfjs nicht garantiert
 * VOR dem ersten `tf.loadLayersModel` läuft (oder vom Bundler eliminiert wird),
 * und das Pure-JS-Backend bei unbekannten Klassen still hängt statt sauber
 * zu fehlern.
 */
export function registerCustomLayers(): void {
  if (registered) return;
  tf.serialization.registerClass(MaskBias);
  registered = true;
}
