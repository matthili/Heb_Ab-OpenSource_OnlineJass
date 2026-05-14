# ADR 0003: Lucia v3 + Argon2id für Authentifizierung

- **Status:** akzeptiert
- **Datum:** 2026-05-14

## Kontext

Wir brauchen Self-Registration mit E-Mail-Verify, Login mit Sessions, Passwort-Reset, später OAuth. Server-autoritatives Spiel macht Sessions in der DB attraktiver als JWT (sofortige Widerrufbarkeit bei User-Block).

## Optionen

1. **Lucia v3** — schlank, Sessions-in-DB-by-Default, framework-agnostisch. OAuth später via Arctic (selber Autor).
2. **Auth.js (NextAuth)** — größere Community, viele OAuth-Provider out-of-box. NestJS-Integration weniger natürlich; Next.js-Erbe spürbar.
3. **NestJS Passport-Strategien** — volle Kontrolle, gut dokumentiertes Pattern. Aber: Sessions/CSRF/Refresh selber zusammenbauen → höheres Risiko.

## Entscheidung

**Lucia v3 + Argon2id.**

- Sessions in Postgres (Lucia-`Session`-Model) → sofort widerrufbar, Block-User wirkt instant.
- Argon2id ist heute der Empfehlungs-Algorithmus (OWASP, NIST). Parameter: m=64MiB, t=3, p=1.
- Lucia macht wenig Magie: explizite `createSession`, `validateSession`, `invalidateSession` — passt zum „server-autoritativ"-Mindset im Spielzustand.
- OAuth-Anbindung (Google/GitHub) erfolgt später additiv via Arctic.

## Konsequenzen

- `apps/api/src/modules/auth/` hostet Lucia-Setup.
- Session-Cookie: HttpOnly + Secure + SameSite=Lax, 30 Tage Lebenszeit.
- WS-Auth: Socket.IO-Handshake liest Cookie, validiert via Lucia, lehnt invalid ab.
- Falls Lucia eingestellt wird oder zu weit driftet: Migration zu Passport-Strategien wäre möglich; Cookie-Format und Session-Model lassen sich übernehmen.
