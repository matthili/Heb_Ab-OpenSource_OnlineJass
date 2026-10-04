/**
 * Vitest-globalSetup-Hook. Wird einmal pro `vitest run` aufgerufen und
 * gibt eine Teardown-Funktion zurück, die am Ende des Laufs ausgeführt wird.
 *
 * Bewusst KEIN Setup-Code hier: das Container-Hochfahren passiert lazy in
 * `setupTestApp()` beim ersten `beforeAll` einer Test-File. So müssen Tests,
 * die das Setup nicht brauchen, auch nicht 30 s warten.
 *
 * Achtung: globalSetup läuft im Vitest-HAUPTPROZESS, die Tests im Worker
 * (gemessen 2026-10-04: verschiedene PIDs). Hier existiert also kein
 * Singleton — `teardownTestApp()` findet nichts und bewirkt nichts. Verwaiste
 * Testcontainer räumt `pretest:integration` (scripts/clean-testcontainers.mjs)
 * vor dem nächsten Lauf weg.
 */
import { teardownTestApp } from "./setup.js";

export default function (): () => Promise<void> {
  return async () => {
    await teardownTestApp();
  };
}
