/**
 * KI-Sitz, der das NN-Modell via Inferenz-Microservice anfragt.
 *
 * **Pipeline pro Move:**
 *   1. State + Maske mit `@jass/engine` encoden (421-dim Float-Vektor + 36-Bit-Maske)
 *   2. POST /predict an den Inferenz-Service
 *   3. `argmax` → `indexToCard` → Karte zurückgeben
 *
 * **Fehler-Verhalten:** Wirft `InferenceUnavailableError` aus dem Client
 * unverändert weiter. Der `GameService` / die `AIPlayerFactory` ist dafür
 * zuständig, in dem Fall auf einen `RandomLegalMovePlayer` zu fallback'en.
 *
 * **Modell-Drift-Schutz:** Wir vergleichen `encoding_version` aus jeder
 * Response gegen `@jass/engine.ENCODING_VERSION`. Ein Mismatch hier ist sehr
 * defensiv — der Inferenz-Service prüft das schon beim Boot — aber wenn doch
 * mal ein anderer Container drauf landet, sehen wir's pro Request.
 */
import { Logger } from "@nestjs/common";
import {
  encodeState,
  ENCODING_VERSION,
  indexToCard,
  legalActionMask,
  type Card,
  type GameState,
} from "@jass/engine";

import { type InferenceClient } from "../../inference/inference-client.service.js";
import { type AIPlayer } from "./random-player.js";

export class NNInferencePlayer implements AIPlayer {
  private readonly log = new Logger(NNInferencePlayer.name);

  constructor(private readonly client: InferenceClient) {}

  async chooseCard(hand: readonly Card[], state: GameState): Promise<Card> {
    const vec = encodeState(hand, state);
    const mask = legalActionMask(hand, state);
    const res = await this.client.predict({
      state: Array.from(vec),
      mask: Array.from(mask),
    });
    if (res.meta.encodingVersion !== ENCODING_VERSION) {
      this.log.warn(
        { expected: ENCODING_VERSION, got: res.meta.encodingVersion },
        "Inferenz-Service liefert anderes encoding_version — Drift möglich"
      );
    }
    if (mask[res.argmax] !== 1) {
      // Sollte nie passieren — der Inferenz-Service hat die Maske intern
      // angewendet und prüft Argmax. Defensives Bail-Out.
      throw new Error(`Inferenz-Service hat illegales argmax=${res.argmax} zurückgegeben`);
    }
    return indexToCard(res.argmax);
  }
}
