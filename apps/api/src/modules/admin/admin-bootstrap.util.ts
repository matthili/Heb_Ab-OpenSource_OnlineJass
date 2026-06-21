/**
 * Erst-Admin-Bootstrap — gemeinsame, framework-freie Logik.
 *
 * Henne-Ei-Problem: Die Rolle `ADMIN` kann nur ein bestehender Admin vergeben
 * (`AdminService.setUserRole` hinter `@Roles('ADMIN')`). Eine frische
 * Installation hat aber **keinen** Admin — niemand käme je rein. Diese Datei
 * löst das auf zwei Wegen, die dieselbe reine Funktion teilen:
 *
 *   1. Env-Var `ADMIN_EMAIL` — beim API-Start (`AdminBootstrapService`) und
 *      direkt bei der Registrierung (Hook in `AuthService`).
 *   2. CLI `pnpm --filter @jass/api admin:grant <email>` — manuell, ohne
 *      Neustart, auch für weitere Admins / Notfall-Wiederherstellung.
 *
 * Bewusst nur `import type` — die Funktionen sind rein (DB-Param rein, Ergebnis
 * raus) und laufen so unverändert im Nest-Prozess **und** im CLI-Script mit
 * einem nackten `PrismaClient`.
 */
import type { PrismaClient, Role } from "@prisma/client";

/** Audit-Action für jede Bootstrap-Beförderung — eine Quelle der Wahrheit. */
export const ADMIN_BOOTSTRAP_ACTION = "admin.bootstrap.promote";

const ADMIN_ROLE: Role = "ADMIN";

/**
 * Liest `ADMIN_EMAIL` aus der Umgebung, normalisiert (trim + lowercase).
 * `null`, wenn nicht gesetzt oder leer — dann ist kein Auto-Admin gewünscht.
 */
export function configuredAdminEmail(): string | null {
  const raw = process.env["ADMIN_EMAIL"];
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** Ergebnis einer Beförderung über eine konkrete E-Mail. */
export type PromoteResult =
  | { kind: "user-not-found"; email: string }
  | { kind: "already-admin"; userId: string; email: string }
  | { kind: "promoted"; userId: string; email: string; previousRole: Role };

/** Wie {@link PromoteResult}, plus der Fall „keine ADMIN_EMAIL gesetzt". */
export type ConfiguredPromoteResult = PromoteResult | { kind: "no-email-configured" };

/**
 * Befördert den User mit der gegebenen E-Mail zu `ADMIN`, falls er existiert
 * und noch kein Admin ist. **Idempotent** — ein zweiter Aufruf liefert
 * `already-admin`. Schreibt selbst KEIN Audit-Log; das macht der Aufrufer mit
 * der für seinen Kontext passenden `source` (`startup` | `register` | `cli`).
 */
export async function promoteUserToAdmin(
  prisma: PrismaClient,
  email: string
): Promise<PromoteResult> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: "insensitive" } },
    select: { id: true, email: true, role: true, emailVerified: true },
  });
  if (!user) return { kind: "user-not-found", email: normalized };
  // Das Admin-Konto wird zugleich als verifiziert markiert: bei E-Mail-
  // Aktivierung wäre der Betreiber sonst ausgesperrt, falls SMTP beim
  // Erst-Setup (noch) nicht läuft — er käme nicht ins Panel, um SMTP zu
  // reparieren. Es ist seine eigene, in ADMIN_EMAIL hinterlegte Adresse →
  // unbedenklich. Deshalb gilt „nichts zu tun" erst, wenn BEIDES schon stimmt.
  if (user.role === ADMIN_ROLE && user.emailVerified) {
    return { kind: "already-admin", userId: user.id, email: user.email };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { role: ADMIN_ROLE, emailVerified: true },
  });
  return { kind: "promoted", userId: user.id, email: user.email, previousRole: user.role };
}

/**
 * Wie {@link promoteUserToAdmin}, aber mit der E-Mail aus `ADMIN_EMAIL`.
 * Liefert `no-email-configured`, wenn die Variable nicht gesetzt ist.
 */
export async function promoteConfiguredAdminEmail(
  prisma: PrismaClient
): Promise<ConfiguredPromoteResult> {
  const email = configuredAdminEmail();
  if (!email) return { kind: "no-email-configured" };
  return promoteUserToAdmin(prisma, email);
}
