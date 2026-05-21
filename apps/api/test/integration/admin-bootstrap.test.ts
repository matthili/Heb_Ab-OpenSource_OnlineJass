/**
 * Integration-Test: Erst-Admin-Bootstrap via `ADMIN_EMAIL`.
 *
 * Szenarien:
 *   1. Registriert sich der in `ADMIN_EMAIL` hinterlegte Account, befördert ihn
 *      der AuthService-Hook sofort zu `ADMIN` (+ Audit-Eintrag).
 *   2. Ein beliebiger anderer Account bleibt `PLAYER`.
 *   3. Startup-Pfad: ein vor dem Setzen von `ADMIN_EMAIL` registrierter User
 *      wird durch `promoteConfiguredAdminEmail` (das, was AdminBootstrapService
 *      beim Boot aufruft) nachträglich befördert — idempotent.
 *   4. Ohne `ADMIN_EMAIL` passiert nichts.
 *
 * `process.env.ADMIN_EMAIL` wird pro Test gesetzt/entfernt — der Register-Hook
 * liest die Variable zur Laufzeit, daher genügt das auch bei der geteilten
 * Test-App (Singleton-Setup).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { promoteConfiguredAdminEmail } from "../../src/modules/admin/admin-bootstrap.util.js";
import { signUpAndIn } from "./auth-helper.js";
import { setupTestApp, type TestAppHandle } from "./setup.js";

const ADMIN_EMAIL = "erster-admin@jass.local";
const PASSWORD = "admin-bootstrap-passw0rd-12!";

describe("Erst-Admin-Bootstrap — ADMIN_EMAIL", () => {
  let app: TestAppHandle;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    await app.resetData();
  });

  afterEach(() => {
    // Safety-Net: keine Variable in den nächsten Test durchsickern lassen.
    delete process.env["ADMIN_EMAIL"];
  });

  it("der in ADMIN_EMAIL hinterlegte Account wird bei der Registrierung Admin", async () => {
    process.env["ADMIN_EMAIL"] = ADMIN_EMAIL;

    const { userId } = await signUpAndIn(app, {
      email: ADMIN_EMAIL,
      password: PASSWORD,
      name: "erster_admin",
    });

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    expect(user?.role).toBe("ADMIN");

    const audit = await app.prisma.auditLog.findFirst({
      where: { action: "admin.bootstrap.promote", target: userId },
    });
    expect(audit, "Bootstrap-Beförderung muss im Audit-Log stehen").not.toBeNull();
    expect((audit?.meta as { source?: string } | null)?.source).toBe("register");
  });

  it("ADMIN_EMAIL ist case-insensitive (Gross-/Kleinschreibung egal)", async () => {
    process.env["ADMIN_EMAIL"] = "  ERSTER-Admin@Jass.Local  "; // Whitespace + Mixed-Case

    const { userId } = await signUpAndIn(app, {
      email: ADMIN_EMAIL,
      password: PASSWORD,
      name: "case_admin",
    });

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    expect(user?.role).toBe("ADMIN");
  });

  it("ein anderer Account wird NICHT Admin", async () => {
    process.env["ADMIN_EMAIL"] = ADMIN_EMAIL;

    const { userId } = await signUpAndIn(app, {
      email: "normalo@jass.local",
      password: PASSWORD,
      name: "normalo",
    });

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    expect(user?.role).toBe("PLAYER");
  });

  it("Startup-Pfad: bereits existierender User wird nachträglich befördert — idempotent", async () => {
    // 1. User registriert sich, BEVOR ADMIN_EMAIL gesetzt ist → bleibt PLAYER.
    const { userId } = await signUpAndIn(app, {
      email: "spaeter-admin@jass.local",
      password: PASSWORD,
      name: "spaeter_admin",
    });
    let user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    expect(user?.role).toBe("PLAYER");

    // 2. Betreiber trägt ADMIN_EMAIL nach → Startup-Logik anstoßen.
    process.env["ADMIN_EMAIL"] = "spaeter-admin@jass.local";
    const first = await promoteConfiguredAdminEmail(app.prisma);
    expect(first.kind).toBe("promoted");

    user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    expect(user?.role).toBe("ADMIN");

    // 3. Zweiter Aufruf (z.B. nächster API-Start) ist idempotent.
    const second = await promoteConfiguredAdminEmail(app.prisma);
    expect(second.kind).toBe("already-admin");
  });

  it("ohne ADMIN_EMAIL meldet promoteConfiguredAdminEmail no-email-configured", async () => {
    delete process.env["ADMIN_EMAIL"];
    const result = await promoteConfiguredAdminEmail(app.prisma);
    expect(result.kind).toBe("no-email-configured");
  });

  it("ADMIN_EMAIL gesetzt, aber kein passender User → user-not-found", async () => {
    process.env["ADMIN_EMAIL"] = "gibt-es-nicht@jass.local";
    const result = await promoteConfiguredAdminEmail(app.prisma);
    expect(result.kind).toBe("user-not-found");
  });
});
