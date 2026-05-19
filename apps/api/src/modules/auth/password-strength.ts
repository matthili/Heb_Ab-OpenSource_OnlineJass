/**
 * Passwort-Stärke-Prüfung mit zxcvbn (TypeScript-Port `@zxcvbn-ts`).
 *
 * **Mindest-Score**: 3 (von 0–4). zxcvbn-Empfehlung „starkes Passwort
 * für Service-Accounts" — laut zxcvbn-Definition braucht das min. 10^10
 * Guesses, was selbst mit Hash-Crack-Hardware Wochen+ kostet. Score 4
 * wäre noch besser, ist aber für User-Memorability brutal.
 *
 * **Kontext-Wörter**: Wir reichen E-Mail-Lokalteil + Display-Name als
 * `userInputs` durch — sodass „matthias2026" abgelehnt wird, wenn der
 * Spieler so heißt. zxcvbn matcht das gegen seine internen
 * Brute-Force-Heuristiken, was deutlich besser ist als naive
 * Substring-Vergleiche.
 *
 * **Sprache**: Wörterbücher für DE + EN. Vorarlberger Dialekt-Begriffe
 * (Weli, Schelle, Jass) wären erfreulich abgedeckt, sind aber in den
 * Standard-Wörterbüchern eher nicht drin — der englische Match-Layer
 * fängt die Mehrzahl der „passw0rd"-Klassiker. Das gewählte Min-Level
 * (3) verträgt auch unbekannte Wörter, solange die Entropie stimmt.
 *
 * **Performance**: zxcvbn ist eine reine Berechnung, kein Netzwerk;
 * pro Check ~5–20ms. Wir laden die Wörterbücher beim ersten Aufruf
 * lazy (= einmaliger Boot-Cost statt globaler Import-Overhead).
 */
import { type OptionsType, zxcvbnAsync, zxcvbnOptions, type ZxcvbnResult } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnDePackage from "@zxcvbn-ts/language-de";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";

export const MIN_PASSWORD_STRENGTH_SCORE = 3;

let initialized = false;
function initOnce(): void {
  if (initialized) return;
  const options: OptionsType = {
    translations: zxcvbnEnPackage.translations,
    graphs: zxcvbnCommonPackage.adjacencyGraphs,
    dictionary: {
      ...zxcvbnCommonPackage.dictionary,
      ...zxcvbnEnPackage.dictionary,
      ...zxcvbnDePackage.dictionary,
    },
  };
  zxcvbnOptions.setOptions(options);
  initialized = true;
}

export interface PasswordStrengthCheck {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  feedback: { warning: string | null; suggestions: readonly string[] };
}

/**
 * Prüft ein Passwort gegen die Mindest-Stärke. `userInputs` sollten
 * Strings sein, die der User selbst kennt (E-Mail, Name) — zxcvbn
 * straft Wiederholungen ab.
 */
export async function checkPasswordStrength(
  password: string,
  userInputs: readonly string[] = []
): Promise<PasswordStrengthCheck> {
  initOnce();
  const result: ZxcvbnResult = await zxcvbnAsync(password, [...userInputs]);
  const score = result.score as 0 | 1 | 2 | 3 | 4;
  return {
    ok: score >= MIN_PASSWORD_STRENGTH_SCORE,
    score,
    feedback: {
      warning: result.feedback.warning ?? null,
      suggestions: result.feedback.suggestions,
    },
  };
}
