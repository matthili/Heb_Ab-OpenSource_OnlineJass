/**
 * Pretest-Cleanup: entfernt verwaiste Testcontainers-Container vor dem
 * Integration-Test-Lauf.
 *
 * **Warum**: Jeder `test:integration`-Lauf startet via Testcontainers je einen
 * Postgres- und Redis-Container. Wird der Vitest-Prozess abgebrochen (Timeout,
 * Strg+C, Crash), läuft der `global-teardown` nicht — und weil der
 * Testcontainers-Reaper (Ryuk) auf diesem Setup nicht aktiv ist, sammeln sich
 * die Container an (Stand einmal: 168 Leichen, ~2,3 GB Volumes).
 *
 * Dieses Skript läuft als `pretest:integration`-npm-Hook automatisch vor
 * `pnpm test:integration` und entfernt alles mit dem Label
 * `org.testcontainers=true` (inkl. anonymer Volumes via `-v`). Den Dev-Stack
 * (`jass-*-dev`) fasst es nicht an — der trägt dieses Label nicht.
 *
 * **Best-effort**: Fehler (Docker nicht gestartet o.ä.) werden geschluckt und
 * brechen den Test-Lauf NICHT ab — die eigentliche Test-Bootstrap meldet
 * fehlendes Docker ohnehin mit klarer Fehlermeldung.
 *
 * Reines Node-Skript (kein Bash) — läuft so auch auf Windows-cmd.
 */
import { execFileSync } from "node:child_process";

const LABEL = "org.testcontainers=true";

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8" });
}

try {
  const ids = docker(["ps", "-aq", "--filter", `label=${LABEL}`])
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    console.log("[clean-testcontainers] keine verwaisten Testcontainer — nichts zu tun.");
    process.exit(0);
  }

  docker(["rm", "-f", "-v", ...ids]);
  console.log(`[clean-testcontainers] ${ids.length} verwaiste Testcontainer entfernt.`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[clean-testcontainers] übersprungen (Docker nicht verfügbar?): ${msg}`);
  process.exit(0);
}
