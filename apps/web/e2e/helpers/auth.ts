/**
 * Auth-Helper für E2E-Tests: kompletter Register-→-Verify-→-Login-Flow
 * über die UI, mit Mailhog-Pickup für den Verify-Link.
 *
 * Wir gehen bewusst über die UI (nicht via API-Helper), damit der E2E
 * den echten User-Flow abdeckt — inkl. Form-Submit, Frontend-Routing
 * und Better-Auth-Cookie-Handling im Browser.
 */
import type { Page } from "@playwright/test";

import { extractLinkFromMail, waitForMailTo } from "./mailhog";

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

export function makeUniqueUser(prefix: string): TestUser {
  const stamp = Date.now() + Math.floor(Math.random() * 10000);
  return {
    name: `${prefix}_${stamp}`,
    email: `${prefix}_${stamp}@jass.test`,
    password: "e2e-test-passw0rd-12!",
  };
}

/**
 * Registriert über die UI, holt sich den Verify-Link aus Mailhog,
 * klickt ihn (verifiziert + redirected zu /?verified=1), und loggt ein.
 * Am Ende sitzt der User in der Lobby.
 */
export async function registerVerifyLogin(page: Page, user: TestUser): Promise<void> {
  await page.goto("/register");
  await page.fill("#name", user.name);
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.getByRole("button", { name: /Konto anlegen|Create account/i }).click();

  // Nach Sign-Up sind wir auf /check-email.
  await page.waitForURL("**/check-email**");

  // Verify-Link aus Mailhog.
  const body = await waitForMailTo(user.email, { subjectIncludes: "best" });
  const verifyUrl = extractLinkFromMail(body, "/api/auth/verify-email");
  // Server-Verify redirected zur callbackURL → unsere Home mit ?verified=1
  await page.goto(verifyUrl);
  // Better-Auth-Verify redirected automatisch; wir warten auf die
  // verified-Indikation.
  await page.waitForURL((url) => url.searchParams.get("verified") === "1", {
    timeout: 10_000,
  });

  // Jetzt Login.
  await page.goto("/login");
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.getByRole("button", { name: /^Anmelden$|^Sign in$/ }).click();
  await page.waitForURL("**/lobby");
}
