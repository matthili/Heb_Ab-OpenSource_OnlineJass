/**
 * Argon2id-Passwort-Hasher für Better Auth.
 *
 * Parameter (OWASP-Empfehlung für Argon2id, Stand 2026):
 *   - memoryCost: 64 MiB
 *   - timeCost:   3 Iterationen
 *   - parallelism: 1
 *   - hashLength: 32 Bytes
 *
 * `@node-rs/argon2` ist eine native (Rust-NAPI) Implementation und bringt
 * vorgebuildete Binaries für die wichtigsten OSes mit — kein
 * `node-gyp`-Theater, keine Windows-Build-Probleme.
 */
import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 exportiert `Algorithm` als const-enum (mit `isolatedModules`
// nicht zugreifbar). Stattdessen das gleiche Zahlenliteral hart kodieren:
// 2 = Argon2id in der `argon2`-Konvention.
const ARGON2_ID = 2 as const;

const ARGON2_OPTS = {
  algorithm: ARGON2_ID,
  memoryCost: 64 * 1024, // 64 MiB in KiB
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(storedHash: string, candidate: string): Promise<boolean> {
  try {
    return await verify(storedHash, candidate);
  } catch {
    // Bei korruptem Hash oder unbekanntem Format: Login schlägt fehl. Niemals
    // True bei Exception zurückgeben — der defensive Default ist „nicht eingeloggt".
    return false;
  }
}
