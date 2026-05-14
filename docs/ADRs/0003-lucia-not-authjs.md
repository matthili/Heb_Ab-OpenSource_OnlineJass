# ADR 0003: Better Auth + Argon2id für Authentifizierung

- **Status:** akzeptiert (ersetzt frühere Lucia-Empfehlung)
- **Datum:** 2026-05-14
- **Geänderter Titel:** „Better Auth statt Lucia/Auth.js/Passport"

## Kontext

Wir brauchen Self-Registration mit E-Mail-Verify, Login mit Sessions, Passwort-Reset, später OAuth. Server-autoritatives Spiel macht Sessions in der DB attraktiver als JWT (sofortige Widerrufbarkeit bei User-Block).

In der ursprünglichen Plan-Diskussion hatten wir **Lucia v3** gewählt — was nicht mehr trägt: Lucia wurde Anfang 2024 vom Maintainer eingestellt. Das Paket ist auf npm vorhanden, bekommt aber keine Security-Updates mehr. Für ein Multi-Jahres-Projekt ist das ein nicht akzeptables Wartungsrisiko.

## Optionen (aktualisiert)

1. **Better Auth** — moderner, aktiv gepflegter Lucia-Nachfolger. Sessions-in-DB by Default, Prisma-Adapter, Email-Verify, OAuth-Provider, Plugin-System. TypeScript-first.
2. **Auth-as-code** — Lucia-Doku als Vorlage, ~200 LOC selbst geschrieben (SessionService, Argon2id, Cookie-Handling). Volle Kontrolle, aber späterer OAuth-Bedarf bedeutet Eigenentwicklung.
3. **Lucia v3 trotzdem** — funktioniert, aber Security-Updates entfallen. Tech-Debt von Tag 1.
4. **NestJS Passport-Strategien** — Mainstream im NestJS-Umfeld, aber Sessions/CSRF/Refresh selbst zusammenbauen → höhere Boilerplate, mehr Eigenrisiko.

## Entscheidung

**Better Auth + Argon2id (custom hasher).**

- Sessions in Postgres (Better Auth standardmäßig) → sofort widerrufbar.
- Argon2id ist Empfehlungs-Algorithmus (OWASP, NIST). Better Auth nutzt per Default scrypt; wir registrieren einen Argon2id-Hasher (`m=64MiB, t=3, p=1`).
- Email-Verify, Passwort-Reset, OAuth-Provider, Account-Linking als Built-Ins — kein Eigenbau nötig.
- Prisma-Adapter passt zur restlichen Tech-Wahl.
- Plugin-System für später: Magic-Link, 2FA, Passkeys möglich, ohne den Auth-Code in der App rumzureichen.

## Konsequenzen

- `apps/api/src/modules/auth/` mountet Better Auth's HTTP-Handler unter `/api/auth/*`.
- Session-Cookie: HttpOnly + Secure + SameSite=Lax, 30 Tage Lebenszeit (Better-Auth-Default, in Config überschreibbar).
- WS-Auth: Socket.IO-Handshake liest das Cookie, validiert via Better-Auth-Session-Lookup, lehnt invalid ab.
- Custom-Argon2id-Hasher: kleines Modul `auth/password.ts` mit `hash(password)` und `verify(hash, password)`, registriert in `better-auth({ ..., emailAndPassword: { passwordHasher: ourHasher } })` (oder dem aktuellen Plugin-Mechanismus).
- Blocklist-Check + Audit-Log: über `before`-Hooks auf signUp/signIn.
- Falls Better Auth in Zukunft eingestellt würde: Session-Schema in Postgres ist Library-unabhängig; eine Migration zu Auth-as-code wäre eine 1-Tages-Aufgabe.

## Historie

- 2026-05-14: ursprünglich Lucia v3 gewählt, dann wegen Lucia-Sunset auf Better Auth umgestellt.
