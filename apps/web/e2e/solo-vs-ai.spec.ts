/**
 * E2E: Plan-Doc §11-Szenario (komprimiert auf einen Browser).
 *
 * Der ursprüngliche §11-Test sieht zwei Browser-Contexts vor — A
 * registriert, eröffnet, B joint, dann Auto-Fill, dann Spielen. Für M7-G
 * ist die solo-vs-3-KI-Variante ausreichend: sie deckt **alle**
 * Pipeline-Stufen ab (Register → Verify-Mail → Login → Tisch öffnen →
 * Auto-Start → KI spielen → User klickt Karte → Stiche durch → Final-
 * Score → Re-Match-UI), in einem Browser-Context.
 *
 * Der Zwei-Browser-Test (Browser A öffnet, B joint via Lobby) ist als
 * Folge-Test wertvoll, aber technisch dieselbe WS-Subscribe-Mechanik,
 * die hier schon abgedeckt ist.
 */
import { expect, test } from "@playwright/test";

import { makeUniqueUser, registerVerifyLogin } from "./helpers/auth";
import { purgeMailhog } from "./helpers/mailhog";

test.beforeEach(async () => {
  await purgeMailhog();
});

test("Solo + 3 KI: Register → Verify → Tisch öffnen → komplette Runde durchspielen", async ({
  page,
}) => {
  const user = makeUniqueUser("e2e_solo");

  // ─── 1. Auth-Flow: Register → Verify → Login ──────────────────────────
  await registerVerifyLogin(page, user);

  // ─── 2. Tisch öffnen mit „Solo gegen 3 KI"-Shortcut ──────────────────
  await page.getByRole("button", { name: /Tisch öffnen|Open table/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // „Solo gegen 3 KI"-Checkbox triggern.
  await dialog.getByLabel(/allein gegen 3 KI/i).check();
  await dialog.getByRole("button", { name: /Tisch öffnen|Open table/ }).click();

  // ─── 3. Spielfläche erscheint ────────────────────────────────────────
  await expect(page.getByRole("region", { name: /Spielfläche|Playing area/i })).toBeVisible({
    timeout: 15_000,
  });

  // Hand sollte 9 Karten zeigen.
  const myCards = page.getByRole("group", { name: /Meine Karten|My cards/i }).getByRole("button");
  await expect(myCards).toHaveCount(9, { timeout: 10_000 });

  // ─── 4. Spiel-Loop: Bei jedem „Du bist dran" eine legale Karte klicken
  // ────────────────────────────────────────────────────────────────────
  // Strategie: poll bis „Du bist dran"-Banner sichtbar ist, dann den
  // ersten klickbaren Karten-Button drücken. Wiederholen bis 9 Stiche
  // gespielt sind (= Hand leer).
  const yourTurn = page.getByText(/Du bist dran|Your turn/);
  for (let trick = 1; trick <= 9; trick++) {
    await expect(yourTurn).toBeVisible({ timeout: 20_000 });
    // Erste klickbare (= legale + enabled) Karte spielen.
    const playable = page
      .getByRole("group", { name: /Meine Karten|My cards/i })
      .getByRole("button", { disabled: false });
    await playable.first().click();
    // Kurz warten, bis der Move durch ist + KIs ihre Züge gemacht haben.
    await page.waitForTimeout(200);
  }

  // ─── 5. Spiel-Ende ───────────────────────────────────────────────────
  await expect(page.getByText(/Spiel beendet|Spiel vorbei|Game over/)).toBeVisible({
    timeout: 15_000,
  });

  // Final-Score-Anzeige hat die beiden Team-Punkte.
  await expect(page.getByText(/Team 0/)).toBeVisible();
  await expect(page.getByText(/Team 1/)).toBeVisible();

  // ─── 6. Re-Match-UI ist sichtbar ─────────────────────────────────────
  await expect(page.getByRole("button", { name: /Ja, nochmal|Yes, again/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Nein, raus|No, out/ })).toBeVisible();
});
