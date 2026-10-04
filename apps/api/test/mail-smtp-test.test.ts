/**
 * Unit-Test der SMTP-Testmail (Admin-Panel → SMTP → „Testmail senden"):
 *   - `buildSmtpTestMail`: Inhalt nennt Server/Port/Absender, nie Zugangsdaten.
 *   - `describeMailError`: Nodemailer-Fehler → eine Admin-taugliche Zeile.
 *   - `MailService.sendSmtpTestMail`: nutzt die effektive Konfiguration und
 *     bricht bei stummem Server nach 20 s ab.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSmtpTestMail,
  describeMailError,
  MailService,
} from "../src/modules/mail/mail.service.js";
import type { SmtpSettingsService } from "../src/modules/mail/smtp-settings.service.js";

const BASE = {
  host: "mail.example.test",
  port: 587,
  from: "Heb ab! <noreply@example.test>",
  noReply: true,
  sentAt: new Date("2026-10-04T12:00:00.000Z"),
};

describe("buildSmtpTestMail", () => {
  it("nennt Server, Port, Absender, Instanz und Zeitpunkt", () => {
    const mail = buildSmtpTestMail({ ...BASE, instanceUrl: "https://jass.example.test" });
    expect(mail.subject).toBe("Heb ab! — SMTP-Testmail");
    expect(mail.text).toContain("mail.example.test:587");
    expect(mail.text).toContain("Heb ab! <noreply@example.test>");
    expect(mail.text).toContain("https://jass.example.test");
    expect(mail.text).toContain("2026-10-04T12:00:00.000Z");
  });

  it("lässt die Instanz-Zeile weg, wenn keine URL bekannt ist", () => {
    const mail = buildSmtpTestMail({ ...BASE, instanceUrl: null });
    expect(mail.text).not.toContain("Instanz");
    expect(mail.text).not.toContain("null");
  });

  it("escaped den Absender im HTML", () => {
    const mail = buildSmtpTestMail({ ...BASE, instanceUrl: null });
    expect(mail.html).toContain("&lt;noreply@example.test&gt;");
    expect(mail.html).not.toContain("<noreply@example.test>");
  });
});

describe("describeMailError", () => {
  it("stellt den Nodemailer-Code voran", () => {
    const err = Object.assign(new Error("Invalid login: 535 Authentication failed"), {
      code: "EAUTH",
    });
    expect(describeMailError(err)).toBe("EAUTH: Invalid login: 535 Authentication failed");
  });

  it("verdoppelt den Code nicht, wenn die Meldung schon damit beginnt", () => {
    const err = Object.assign(new Error("ECONNREFUSED 127.0.0.1:1025"), { code: "ECONNREFUSED" });
    expect(describeMailError(err)).toBe("ECONNREFUSED 127.0.0.1:1025");
  });

  it("kommt mit Nicht-Errors klar und kürzt auf 300 Zeichen", () => {
    expect(describeMailError("kaputt")).toBe("kaputt");
    const long = describeMailError(new Error("x".repeat(500)));
    expect(long).toHaveLength(300);
    expect(long.endsWith("...")).toBe(true);
  });
});

describe("MailService.sendSmtpTestMail", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function serviceWith(dbSettings: Record<string, unknown>): MailService {
    const settings = { get: async () => dbSettings } as unknown as SmtpSettingsService;
    return new MailService(settings);
  }

  it("schickt mit der effektiven Konfiguration an den Empfänger", async () => {
    const mail = serviceWith({ host: "smtp.db.test", port: 2525, from: "absender@jass.test" });
    const send = vi.spyOn(mail, "send").mockResolvedValue(undefined);

    await mail.sendSmtpTestMail("empfaenger@jass.test");

    expect(send).toHaveBeenCalledTimes(1);
    const envelope = send.mock.calls[0]![0];
    expect(envelope.to).toBe("empfaenger@jass.test");
    expect(envelope.subject).toBe("Heb ab! — SMTP-Testmail");
    expect(envelope.text).toContain("smtp.db.test:2525");
    expect(envelope.text).toContain("absender@jass.test");
  });

  it("bricht nach 20 s mit einer Zeitüberschreitung ab, wenn der Server schweigt", async () => {
    vi.useFakeTimers();
    const mail = serviceWith({ host: "stumm.test", port: 25 });
    vi.spyOn(mail, "send").mockReturnValue(new Promise<void>(() => {}));

    const pending = mail.sendSmtpTestMail("empfaenger@jass.test");
    const assertion = expect(pending).rejects.toThrow(/Zeitüberschreitung/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });
});
