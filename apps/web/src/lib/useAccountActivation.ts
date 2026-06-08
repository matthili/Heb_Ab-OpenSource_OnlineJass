/**
 * Liest den öffentlichen Konto-Freischaltungs-Modus vom Server
 * (`GET /api/config`), damit Register-/Login-Flows die passende Meldung
 * zeigen können:
 *   - `"email"` (Default) — Bestätigungslink per E-Mail.
 *   - `"admin"` (LAN-Mode) — ein Admin schaltet das Konto frei; keine Mail.
 *
 * Login-frei abrufbar; `staleTime: Infinity`, da sich der Modus zur Laufzeit
 * nicht ändert. Fällt auf `"email"` zurück, solange/falls der Wert fehlt.
 */
import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

export type AccountActivation = "email" | "admin";

export function useAccountActivation(): AccountActivation {
  const { data } = useQuery<{ accountActivation: AccountActivation }>({
    queryKey: ["public-config", "account-activation"],
    queryFn: () => api("/api/config"),
    staleTime: Infinity,
  });
  return data?.accountActivation ?? "email";
}
