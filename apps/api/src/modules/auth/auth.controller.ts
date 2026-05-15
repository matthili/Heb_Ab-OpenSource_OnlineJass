/**
 * Brücke zwischen Fastify und der Better-Auth-Instanz.
 *
 * Better Auth nutzt die Web-Fetch-API (`Request → Promise<Response>`); Fastify
 * arbeitet mit eigenen `FastifyRequest`/`FastifyReply`-Objekten. Wir
 * konvertieren in beide Richtungen — der Aufwand ist gering, weil Better Auth
 * sein eigenes Routing und Body-Parsing macht.
 *
 * Alle Auth-Endpunkte (signup, signin, callback, verify, …) leben unter
 * `/api/auth/*` und werden hier durchgereicht.
 */
import { All, Controller, Logger, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { AuthService } from "./auth.service.js";

@Controller("api/auth")
export class AuthController {
  private readonly log = new Logger(AuthController.name);

  constructor(private readonly auth: AuthService) {}

  // Catch-all für /api/auth/<irgendwas>. Fastify's find-my-way akzeptiert nur
  // `*` als Wildcard am Pfad-Ende; das überschattet *nicht* andere Routen mit
  // anderem Prefix.
  @All("*")
  async handle(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const webRequest = toWebRequest(req);
    let response: Response;
    try {
      response = await this.auth.auth.handler(webRequest);
    } catch (err) {
      this.log.error({ err, url: req.url }, "Better Auth handler threw");
      reply.code(500).send({ error: "Internal Server Error" });
      return;
    }
    await sendWebResponseViaFastify(response, reply);
  }
}

/**
 * Konvertiert eine Fastify-Request in eine Web-Request, damit Better Auth sie
 * verarbeiten kann. Body wird als String/Buffer übernommen, Header werden
 * weitergegeben. Wir setzen die Origin auf die volle URL, weil Better Auth
 * Same-Origin- und CSRF-Checks darauf stützt.
 */
function toWebRequest(req: FastifyRequest): Request {
  const protocol = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers["host"] ?? "localhost:3000";
  const url = `${protocol}://${host}${req.url}`;

  // Body: bei GET/HEAD keiner, sonst Fastify hat ihn schon geparst — wir
  // serialisieren ihn zurück. Better Auth liest seinerseits wieder JSON.
  const method = req.method;
  const hasBody = method !== "GET" && method !== "HEAD" && req.body !== undefined;
  const body = hasBody ? JSON.stringify(req.body) : undefined;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, String(value));
    }
  }
  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, body !== undefined ? { method, headers, body } : { method, headers });
}

/**
 * Spiegelt eine Web-Response (Better Auth) zurück über FastifyReply: Status,
 * Headers (inkl. Set-Cookie — `getSetCookie()` korrekt mehrfach setzen) und
 * Body.
 */
async function sendWebResponseViaFastify(response: Response, reply: FastifyReply): Promise<void> {
  reply.status(response.status);

  // Set-Cookie kann mehrfach gesetzt sein; Headers.getSetCookie ist Node 20+.
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) {
    reply.header("set-cookie", cookies);
  }
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    reply.header(key, value);
  });

  const text = await response.text();
  reply.send(text);
}
