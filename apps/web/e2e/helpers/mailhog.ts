/**
 * Mailhog-API-Helper für E2E-Tests.
 *
 * Mailhog ist der Dev-SMTP-Sink (Port 1025/SMTP, 8025/Web+API). Die
 * REST-API stellt die empfangenen Mails unter `GET /api/v2/messages`
 * bereit. Wir polln solange, bis eine Mail an die gewünschte Adresse
 * eintrifft, und extrahieren den Verify-/Reset-Link aus dem Body.
 *
 * Voraussetzung: `pnpm dev:stack` läuft (siehe playwright.config.ts).
 */
const MAILHOG_BASE = "http://localhost:8025";

interface MailhogV2Message {
  Content: {
    Headers: { To?: string[]; Subject?: string[] };
    Body: string;
  };
  Created: string;
}

interface MailhogV2Response {
  items: MailhogV2Message[];
}

/**
 * Wartet bis zu `timeoutMs` Millisekunden auf eine Mail an `to`. Returnt
 * den Body (text+html zusammen). Wirft, wenn nichts ankommt.
 */
export async function waitForMailTo(
  to: string,
  options: { timeoutMs?: number; subjectIncludes?: string } = {}
): Promise<string> {
  const { timeoutMs = 15_000, subjectIncludes } = options;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${MAILHOG_BASE}/api/v2/messages`);
    if (res.ok) {
      const data = (await res.json()) as MailhogV2Response;
      const match = data.items.find((m) => {
        const headers = m.Content.Headers;
        const recipients = headers.To?.join(",") ?? "";
        if (!recipients.toLowerCase().includes(to.toLowerCase())) return false;
        if (subjectIncludes) {
          const subj = headers.Subject?.join(" ") ?? "";
          if (!subj.includes(subjectIncludes)) return false;
        }
        return true;
      });
      if (match) return match.Content.Body;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout: keine Mail an ${to} innerhalb von ${timeoutMs}ms`);
}

/**
 * Sucht im Mail-Body einen Verify/Reset-Link mit dem gegebenen
 * Pfad-Prefix (z.B. `/api/auth/verify-email`). Returnt die volle URL
 * (vom Server her ist das `http://localhost:3000/api/auth/...`).
 */
export function extractLinkFromMail(body: string, pathPrefix: string): string {
  // Mailhog liefert quoted-printable encoded Body. Wir suchen einen
  // unquoted-printable-Match — `=`-Encodings können in URLs auftreten,
  // also normalisieren wir erst weiche Zeilenumbrüche `=\r\n` weg.
  const normalized = body.replace(/=\r?\n/g, "");
  // Suche `http(s)://<host>:<port>{pathPrefix}…` bis zum nächsten
  // Whitespace, `"` oder `<`.
  const re = new RegExp(`https?://[^\\s"<>]*${escapeRegex(pathPrefix)}[^\\s"<>]*`);
  const match = normalized.match(re);
  if (!match) {
    throw new Error(`Kein Link mit ${pathPrefix} im Mail-Body gefunden`);
  }
  return match[0];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Räumt die Mailhog-Inbox auf — vor jedem Test sinnvoll. */
export async function purgeMailhog(): Promise<void> {
  await fetch(`${MAILHOG_BASE}/api/v1/messages`, { method: "DELETE" }).catch(() => {
    /* Mailhog nicht erreichbar — Tests schlagen sowieso fehl */
  });
}
