/**
 * M11-C: a11y-Sweep via axe-core.
 *
 * Wir prüfen die Hauptrouten der SPA mit `@axe-core/playwright` gegen
 * **WCAG 2.1 AA** (Plan-Doc §1). Das Done-when-Kriterium ist
 * „0 Critical-Violations" — bei Serious lassen wir's offen, weil
 * Radix-Primitives manchmal Heuristiken triggern, die in der Praxis okay
 * sind (z.B. `<details>`-Toggle wird als „interactive in non-button"
 * markiert).
 *
 * Anti-Flake: wir warten je Page auf den Hauptinhalt (`<main>`-Heading
 * oder konkretes Test-ID), bevor axe loslegt. Sonst kann axe schon
 * Snapshots vom Skeleton-State machen und falsch-positive
 * `aria-hidden`-Violations melden.
 *
 * Voraussetzungen: SPA läuft (siehe `playwright.config.ts`). Mailhog
 * für die Verify-Mail im Auth-Pfad.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { makeUniqueUser, registerVerifyLogin } from "./helpers/auth";
import { purgeMailhog } from "./helpers/mailhog";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function audit(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const critical = results.violations.filter((v) => v.impact === "critical");
  if (critical.length > 0) {
    console.error(`[a11y:${label}] Critical-Violations:`);
    for (const v of critical) {
      console.error(`  - ${v.id} (${v.help}): ${v.nodes.length} Knoten`);
      for (const node of v.nodes.slice(0, 3)) {
        console.error(`      target=${JSON.stringify(node.target)}`);
        console.error(`      html=${node.html.slice(0, 200)}`);
      }
    }
  }
  // Done-when: 0 Critical. Serious wird beobachtet, aber nicht hart
  // gegated (siehe Header-Kommentar).
  expect(critical, `${label}: ${critical.length} Critical-Violations`).toEqual([]);
}

test.describe("a11y — WCAG 2.1 AA-Audit auf Hauptrouten", () => {
  test("Anonyme Routen: Landing-Login, Register, Forgot", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await audit(page, "/login");

    await page.goto("/register");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await audit(page, "/register");

    await page.goto("/forgot");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await audit(page, "/forgot");
  });

  test("Eingeloggte Routen: Lobby, Profil-History, Profil-Daten", async ({ page }) => {
    await purgeMailhog();
    const user = makeUniqueUser("e2e_a11y");
    await registerVerifyLogin(page, user);

    // Lobby
    await page.goto("/lobby");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await audit(page, "/lobby");

    // Profil-History
    await page.goto("/profile");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await audit(page, "/profile (History)");

    // Profil-Daten-Tab (DSGVO-Export + Konto-Löschen)
    await page.goto("/profile?tab=data");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await audit(page, "/profile (Daten)");
  });
});
