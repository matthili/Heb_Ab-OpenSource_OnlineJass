/**
 * Baut den DM-Channel-Key aus zwei User-IDs — deterministisch sortiert, exakt
 * wie `makeDmChannelKey` im Backend (apps/api/.../chat.dto.ts). Beide Seiten
 * MÜSSEN dieselbe Reihenfolge erzeugen, sonst landen Sender und Empfänger in
 * verschiedenen Kanälen.
 */
export function makeDmChannelKey(userA: string, userB: string): string {
  const [a, b] = [userA, userB].sort();
  return `dm:${a}:${b}`;
}
