/**
 * Schlanker HTTP-Helper für Integration-Tests.
 *
 * Better Auth setzt die Session als HttpOnly-Cookie über `Set-Cookie`. Damit
 * Folge-Requests authentisiert sind, müssen wir die Cookies persistent
 * mitführen. `globalThis.fetch` macht das nicht; statt ein Drittpartei-Paket
 * dafür einzuhängen, ist die Logik hier ein Dutzend Zeilen.
 *
 * Wir behandeln nur den Happy-Path:
 *   - Set-Cookie wird gesammelt (letzter Wert pro Cookie-Name gewinnt — ok für
 *     unseren Auth-Flow).
 *   - Cookie-Header wird bei jedem Request mitgesendet.
 *   - Ausgelaufene Cookies (max-age=0 oder Expires in der Vergangenheit)
 *     bleiben drin — das macht für unsere kurzlebigen Tests keinen Unterschied,
 *     und die Server-Seite würdigt sie ohnehin nicht.
 */

export interface HttpClient {
  baseUrl: string;
  cookies: Map<string, string>;
  request: <T = unknown>(path: string, init?: RequestInit) => Promise<{ status: number; body: T }>;
  /** Cookie-Header so, wie er an Socket.IO mitgegeben werden kann. */
  cookieHeader: () => string;
  reset: () => void;
}

export function createHttpClient(baseUrl: string): HttpClient {
  const cookies = new Map<string, string>();

  return {
    baseUrl,
    cookies,
    cookieHeader: () =>
      Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    reset: () => cookies.clear(),
    async request<T>(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers ?? {});
      // Default-Content-Type für POSTs mit Body
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      if (cookies.size > 0) {
        headers.set(
          "Cookie",
          Array.from(cookies.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join("; ")
        );
      }
      const res = await fetch(`${baseUrl}${path}`, { ...init, headers });

      // `getSetCookie()` ist Node-22 Standard. Wir parsen nur Name=Value, der
      // Rest (Path, HttpOnly, …) interessiert den Client nicht — der Server
      // verlässt sich auf Cookie-Werte allein.
      const setCookies =
        typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
        "function"
          ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
          : [];
      for (const raw of setCookies) {
        const firstSemi = raw.indexOf(";");
        const pair = firstSemi >= 0 ? raw.slice(0, firstSemi) : raw;
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        cookies.set(name, value);
      }

      // Body als JSON parsen, wenn möglich; sonst Text als Fallback.
      let body: unknown;
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        body = await res.json().catch(() => undefined);
      } else {
        const text = await res.text().catch(() => "");
        body = text;
      }
      return { status: res.status, body: body as T };
    },
  };
}
