/**
 * Unit-Tests der reinen Logik der Degradations-Alarmierung:
 *   - `toComponentDownMap`: welche Komponenten gelten als ausgefallen?
 *   - `diffComponentStates`: bei welchen Zustands-Wechseln wird alarmiert?
 */
import { describe, expect, it } from "vitest";

import {
  diffComponentStates,
  toComponentDownMap,
  type ComponentDownMap,
} from "../src/modules/admin/degradation-alert.service.js";
import type { SystemStatus } from "../src/modules/admin/system-status.service.js";

const baseStatus = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  db: { ok: true },
  migrations: { applied: 1, latest: null, latestAt: null },
  redis: { ok: true },
  inference: { available: true, lastCheckedAt: null, baseUrl: "x" },
  smtp: { host: "h", port: 25, ok: true },
  landing: { url: null, ok: null },
  mode: { nodeEnv: "test", selfHost: false, accountActivation: "email", captchaEnabled: false },
  runtime: { nodeVersion: "v22", uptimeSeconds: 1 },
  checkedAt: "now",
  ...over,
});

describe("toComponentDownMap", () => {
  it("alles ok → keine Komponente down", () => {
    const m = toComponentDownMap(baseStatus());
    expect(m).toEqual({ inference: false, smtp: false });
  });

  it("Inferenz weg → inference=down", () => {
    const m = toComponentDownMap(
      baseStatus({ inference: { available: false, lastCheckedAt: null, baseUrl: "x" } })
    );
    expect(m["inference"]).toBe(true);
  });

  it("SMTP nur bei E-Mail-Aktivierung überwacht", () => {
    const admin = toComponentDownMap(
      baseStatus({
        mode: { nodeEnv: "t", selfHost: true, accountActivation: "admin", captchaEnabled: false },
        smtp: { host: "h", port: 25, ok: false },
      })
    );
    expect(admin["smtp"]).toBeUndefined(); // im Admin-Modus kein SMTP-Alarm
  });

  it("Landing nur wenn konfiguriert (url != null)", () => {
    const off = toComponentDownMap(baseStatus({ landing: { url: null, ok: null } }));
    expect(off["landing"]).toBeUndefined();
    const on = toComponentDownMap(baseStatus({ landing: { url: "http://landing", ok: false } }));
    expect(on["landing"]).toBe(true);
  });
});

describe("diffComponentStates", () => {
  const map = (over: ComponentDownMap): ComponentDownMap => ({
    inference: false,
    smtp: false,
    ...over,
  });

  it("erster Lauf meldet nur bereits Ausgefallenes (nicht den Normalzustand)", () => {
    expect(diffComponentStates(null, map({}))).toEqual([]);
    expect(diffComponentStates(null, map({ inference: true }))).toEqual([
      { component: "inference", down: true },
    ]);
  });

  it("ok→down und down→ok werden gemeldet", () => {
    expect(diffComponentStates(map({}), map({ smtp: true }))).toEqual([
      { component: "smtp", down: true },
    ]);
    expect(diffComponentStates(map({ smtp: true }), map({}))).toEqual([
      { component: "smtp", down: false },
    ]);
  });

  it("unveränderter Zustand → keine Meldung", () => {
    expect(diffComponentStates(map({ inference: true }), map({ inference: true }))).toEqual([]);
  });
});
