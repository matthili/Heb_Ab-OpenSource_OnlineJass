/**
 * Heb ab! — Uptime-Watchdog
 *
 * Ein bewusst eigenständiger Mini-Dienst (KEIN Teil der API), der die API
 * regelmäßig auf `/health` pingt und den Admin per E-Mail alarmiert, wenn sie
 * mehrmals in Folge nicht antwortet — und wieder, sobald sie zurück ist.
 *
 * Warum separat? Aus einem sterbenden Prozess heraus kann man nicht zuverlässig
 * mailen. Der Watchdog läuft als eigener Container und überlebt den API-Crash.
 *
 * Konfiguration (alles über Env-Variablen):
 *   WATCHDOG_TARGET_URL            Health-URL (Default http://api:3000/health)
 *   WATCHDOG_INTERVAL_SECONDS      Ping-Intervall (Default 30)
 *   WATCHDOG_TIMEOUT_SECONDS       Timeout pro Ping (Default 5)
 *   WATCHDOG_FAILURES_BEFORE_ALERT Fehler in Folge bis zum Alarm (Default 3)
 *   WATCHDOG_ALERT_EMAIL           Empfänger (= „Admin hinterlegt eine Mail")
 *   WATCHDOG_LABEL                 Anzeigename in der Mail (Default "Heb ab!")
 *   SMTP_HOST/PORT/USER/PASSWORD/FROM   wie bei der API (gleiche Variablen)
 */
import nodemailer from "nodemailer";

const env = process.env;
const TARGET = env.WATCHDOG_TARGET_URL ?? "http://api:3000/health";
const INTERVAL_MS = (Number(env.WATCHDOG_INTERVAL_SECONDS) || 30) * 1000;
const TIMEOUT_MS = (Number(env.WATCHDOG_TIMEOUT_SECONDS) || 5) * 1000;
const FAILS_BEFORE_ALERT = Number(env.WATCHDOG_FAILURES_BEFORE_ALERT) || 3;
const ALERT_EMAIL = env.WATCHDOG_ALERT_EMAIL ?? "";
const LABEL = env.WATCHDOG_LABEL ?? "Heb ab!";

const SMTP = {
  host: env.SMTP_HOST ?? "localhost",
  port: Number(env.SMTP_PORT ?? "587"),
  user: env.SMTP_USER || undefined,
  password: env.SMTP_PASSWORD || undefined,
  from: env.SMTP_FROM ?? "noreply@jass.local",
};

const log = (...a) => console.log(`[watchdog] ${new Date().toISOString()}`, ...a);

let consecutiveFailures = 0;
let downSince = null; // Date, ab wann der Schwellwert überschritten wurde
let alertedDown = false; // „DOWN"-Mail schon raus?

async function ping() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TARGET, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function sendAlert(subject, body) {
  if (!ALERT_EMAIL) {
    log("WARN: WATCHDOG_ALERT_EMAIL nicht gesetzt — KEIN Alarm verschickt:", subject);
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP.host,
      port: SMTP.port,
      secure: SMTP.port === 465,
      ...(SMTP.user && SMTP.password ? { auth: { user: SMTP.user, pass: SMTP.password } } : {}),
    });
    await transporter.sendMail({ from: SMTP.from, to: ALERT_EMAIL, subject, text: body });
    log("Alarm-Mail verschickt an", ALERT_EMAIL, "—", subject);
  } catch (err) {
    log("FEHLER beim Mailversand:", err?.message ?? err);
  }
}

async function tick() {
  const ok = await ping();
  if (ok) {
    if (alertedDown) {
      const downSec = downSince ? Math.round((Date.now() - downSince.getTime()) / 1000) : 0;
      await sendAlert(
        `✅ ${LABEL}: API wieder erreichbar`,
        `Die API (${TARGET}) antwortet wieder.\n` +
          `Ausfalldauer: ca. ${downSec} s.\nZeit: ${new Date().toISOString()}`
      );
    } else if (consecutiveFailures > 0) {
      log(`OK — wieder erreichbar nach ${consecutiveFailures} Fehlversuch(en).`);
    }
    consecutiveFailures = 0;
    downSince = null;
    alertedDown = false;
  } else {
    consecutiveFailures++;
    log(`Fehlversuch ${consecutiveFailures}/${FAILS_BEFORE_ALERT} — ${TARGET} nicht erreichbar.`);
    if (consecutiveFailures >= FAILS_BEFORE_ALERT && !alertedDown) {
      downSince = downSince ?? new Date();
      alertedDown = true;
      await sendAlert(
        `🚨 ${LABEL}: API nicht erreichbar`,
        `Die API (${TARGET}) hat ${consecutiveFailures}× in Folge nicht geantwortet.\n` +
          `Erstmals seit: ${downSince.toISOString()}\n\n` +
          `Docker/k8s starten den Dienst normalerweise automatisch neu — bitte trotzdem prüfen.`
      );
    }
  }
}

// Der Watchdog selbst darf NIE sterben — ein Fehler im Tick/Mailversand wird
// nur geloggt, der Loop läuft weiter.
process.on("unhandledRejection", (r) => log("unhandledRejection (ignoriert):", r));
process.on("uncaughtException", (e) => log("uncaughtException (ignoriert):", e?.message ?? e));

log(
  `Start: pinge ${TARGET} alle ${INTERVAL_MS / 1000}s (Timeout ${TIMEOUT_MS / 1000}s, ` +
    `Alarm nach ${FAILS_BEFORE_ALERT} Fehlern in Folge). ` +
    `Empfänger: ${ALERT_EMAIL || "(nicht gesetzt — es wird NICHT gemailt!)"}`
);
setInterval(() => void tick().catch((e) => log("tick-Fehler:", e?.message ?? e)), INTERVAL_MS);
void tick().catch((e) => log("initial tick-Fehler:", e?.message ?? e));
