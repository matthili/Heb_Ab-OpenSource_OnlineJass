/**
 * Better-Auth-Endpunkte, an die wir eigene Regeln hängen: Captcha-Pflicht,
 * strengere Rate-Limits, Passwort-Checks (siehe `auth.service.ts`).
 *
 * **Warum zentral:** Better Auth benennt Endpunkte zwischen Versionen um — aus
 * `/forget-password` wurde `/request-password-reset`. Unser Code nutzte den
 * alten Namen, den die eingesetzte Version (1.6) gar nicht kennt. Eine Regel auf
 * einem Pfad, den es nicht gibt, greift still nie: Captcha und Rate-Limit waren
 * auf dem echten Reset-Endpunkt aus, und das Reset-Formular lief ins Leere.
 * `test/auth-paths.test.ts` prüft jeden Pfad hier gegen die
 * Endpunktliste der installierten Better-Auth-Version — eine erneute
 * Umbenennung fällt damit beim Update auf, nicht erst im Betrieb.
 */
export const AUTH_PATHS = {
  getSession: "/get-session",
  signUpEmail: "/sign-up/email",
  signInEmail: "/sign-in/email",
  requestPasswordReset: "/request-password-reset",
  verifyEmail: "/verify-email",
  resetPassword: "/reset-password",
} as const;
