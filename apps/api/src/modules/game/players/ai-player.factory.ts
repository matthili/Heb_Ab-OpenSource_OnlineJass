/**
 * Erstellt KI-Sitz-Instanzen abhängig vom `aiSeatType`-String aus dem
 * `GameSeat`-Row.
 *
 * Bekannte Typen:
 *   - `"random"`           — RandomLegalMovePlayer (Baseline, ohne externe Deps)
 *   - `"heuristic"`        — HeuristicPlayer (Default-KI, deutlich stärker
 *                            als random, ohne externe Deps)
 *   - `"nn"` / `"nn-vX.Y"` — NNInferencePlayer (HTTP zum Inferenz-Service)
 *
 * Weil `NNInferencePlayer` den injizierten `InferenceClient` braucht, kann
 * die Player-Konstruktion nicht aus einer freien Funktion kommen — daher
 * dieser Factory-Service mit Nest-DI.
 */
import { Injectable } from "@nestjs/common";

import { InferenceClient } from "../../inference/inference-client.service.js";
import { HeuristicPlayer } from "./heuristic-player.js";
import { NNInferencePlayer } from "./nn-player.js";
import { RandomLegalMovePlayer, type AIPlayer } from "./random-player.js";

@Injectable()
export class AIPlayerFactory {
  constructor(private readonly inference: InferenceClient) {}

  create(aiSeatType: string): AIPlayer {
    if (aiSeatType === "random") return new RandomLegalMovePlayer();
    if (aiSeatType === "heuristic") return new HeuristicPlayer();
    if (aiSeatType === "nn" || aiSeatType.startsWith("nn-")) {
      return new NNInferencePlayer(this.inference);
    }
    throw new Error(`Unknown aiSeatType: ${aiSeatType}`);
  }
}
