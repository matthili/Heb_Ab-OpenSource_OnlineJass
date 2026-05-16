/**
 * Vitest-globalSetup-Hook. Wird einmal pro `vitest run` aufgerufen und
 * gibt eine Teardown-Funktion zurück, die am Worker-Ende läuft.
 *
 * Bewusst KEIN Setup-Code hier: das Container-Hochfahren passiert lazy in
 * `setupTestApp()` beim ersten `beforeAll` einer Test-File. So müssen Tests,
 * die das Setup nicht brauchen, auch nicht 30 s warten.
 *
 * Der Teardown hier garantiert nur, dass am Ende kein hängender Container
 * übrig bleibt — selbst wenn ein Test-Suite-Crash den File-lokalen
 * `afterAll`-Hook nicht erreichen würde.
 */
import { teardownTestApp } from "./setup.js";

export default function (): () => Promise<void> {
  return async () => {
    await teardownTestApp();
  };
}
