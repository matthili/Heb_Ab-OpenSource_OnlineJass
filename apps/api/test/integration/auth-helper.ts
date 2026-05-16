/**
 * Auth-Helper für Integration-Tests, die einen eingeloggten User brauchen.
 *
 * Vereinigt Register → Verify (über den Mail-Sink) → Sign-In in einem einzigen
 * Call. Returnt das HTTP-Client-Handle mit dem Session-Cookie + die User-ID.
 *
 * Nutzung:
 *   const { http, userId } = await signUpAndIn(app, "matti@jass.local", "password!!12chars");
 *   await http.request("/api/games", { method: "POST", body: JSON.stringify({…}) });
 */
import { createHttpClient, type HttpClient } from "./http-client.js";
import type { TestAppHandle } from "./setup.js";

export interface SignedInUser {
  http: HttpClient;
  userId: string;
  email: string;
  name: string;
}

export async function signUpAndIn(
  app: TestAppHandle,
  opts: { email: string; password: string; name: string }
): Promise<SignedInUser> {
  const http = createHttpClient(app.baseUrl);
  const { email, password, name } = opts;

  // 1. Sign-up
  const signUp = await http.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
  if (signUp.status !== 200) {
    throw new Error(`sign-up failed: ${signUp.status} ${JSON.stringify(signUp.body)}`);
  }

  // 2. Verify-Mail aus dem Sink ziehen
  const mail = app.capturedMails.find((m) => m.to === email);
  if (!mail) throw new Error("Keine Verify-Mail im Sink");
  const verifyUrl = new URL(mail.verifyUrl);
  const verify = await http.request(`${verifyUrl.pathname}${verifyUrl.search}`, {
    method: "GET",
    redirect: "manual",
  });
  if (verify.status >= 400) {
    throw new Error(`verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  }

  // 3. Sign-in (Cookie wird vom http-client festgehalten)
  const signIn = await http.request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (signIn.status !== 200) {
    throw new Error(`sign-in failed: ${signIn.status} ${JSON.stringify(signIn.body)}`);
  }

  // 4. User-ID aus der DB holen (einfacher als Better-Auth-Response zu parsen)
  const user = await app.prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("User nach sign-in nicht in DB");
  return { http, userId: user.id, email, name };
}

/**
 * Set-Cookie-Liste so formatiert, dass sie als HTTP-Header an Socket.IO
 * weitergegeben werden kann (extraHeaders.Cookie).
 */
export function cookieHeaderFor(http: HttpClient): string {
  return http.cookieHeader();
}
