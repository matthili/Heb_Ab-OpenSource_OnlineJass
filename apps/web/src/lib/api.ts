/**
 * Schmaler fetch-Wrapper für die REST-API.
 *
 * **Cookie-Auth**: relative URLs (`/api/…`) → gleicher Origin → Browser
 * schickt den Better-Auth-Cookie automatisch mit. Kein extra
 * `credentials: "include"` nötig.
 *
 * **Fehler-Behandlung**: nicht-OK-Responses werfen `ApiError`. Wir lesen
 * den Body als JSON, falls möglich, und reichen die Server-Message in
 * `err.message` durch — damit die UI die Server-Diagnose direkt zeigen
 * kann (z.B. „Tisch ist voll").
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions<TBody = unknown> {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: TBody;
  signal?: AbortSignal;
  /** Wenn true, parsen wir die Response nicht (für Endpoints, die 204 No-Content liefern). */
  raw?: boolean;
}

export async function api<TResponse = unknown, TBody = unknown>(
  path: string,
  opts: ApiOptions<TBody> = {}
): Promise<TResponse> {
  const { method = "GET", body, signal, raw = false } = opts;
  // `exactOptionalPropertyTypes: true` verbietet `undefined` als Wert für
  // optionale Properties — daher Felder bedingt einbauen statt mit
  // undefined explizit zu setzen.
  const init: RequestInit = {
    method,
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    ...(signal ? { signal } : {}),
  };
  const res = await fetch(path, init);

  if (!res.ok) {
    let parsed: unknown;
    let message = `${method} ${path} → ${res.status}`;
    try {
      parsed = await res.json();
      if (
        parsed &&
        typeof parsed === "object" &&
        "message" in parsed &&
        typeof (parsed as { message: unknown }).message === "string"
      ) {
        message = (parsed as { message: string }).message;
      }
    } catch {
      /* kein JSON-Body — Default-Message bleibt */
    }
    throw new ApiError(message, res.status, parsed);
  }

  if (raw) return undefined as TResponse;
  // 204 No-Content kann auch beim normalen Pfad vorkommen.
  if (res.status === 204) return undefined as TResponse;
  return (await res.json()) as TResponse;
}
