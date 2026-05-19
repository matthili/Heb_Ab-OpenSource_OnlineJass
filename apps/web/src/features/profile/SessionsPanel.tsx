/**
 * „Aktive Sitzungen"-Tab im Profil.
 *
 * Listet alle gültigen Sessions des Users:
 *   - Erstellt / zuletzt aktiv / läuft ab
 *   - User-Agent (Browser/OS-String, best effort)
 *   - IP-Prefix (anonymisiert auf /24 IPv4 oder /48 IPv6)
 *   - Markierung „diese Sitzung"
 *
 * Pro Eintrag „Diese Sitzung abmelden". Aktuelle Sitzung kann hier
 * NICHT widerrufen werden (würde mitten im Request 401 produzieren) —
 * dafür gibt's den regulären Logout im Header.
 *
 * Plus: „Alle anderen abmelden"-Notfall-Button mit Confirm.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "~/lib/api";

interface SessionView {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipPrefix: string | null;
  current: boolean;
}

export function SessionsPanel() {
  const queryClient = useQueryClient();
  const queryKey = ["users", "me", "sessions"] as const;
  const { data, isPending, error } = useQuery<{ sessions: SessionView[] }>({
    queryKey,
    queryFn: () => api<{ sessions: SessionView[] }>("/api/users/me/sessions"),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey });
  };

  const revoke = useMutation({
    mutationFn: (sid: string) =>
      api(`/api/users/me/sessions/${sid}`, { method: "DELETE", raw: true }),
    onSuccess: invalidate,
  });
  const revokeAll = useMutation({
    mutationFn: () => api<{ revoked: number }>("/api/users/me/sessions", { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const [confirmAll, setConfirmAll] = useState(false);

  if (isPending) return <p className="text-stone-500">…</p>;
  if (error) {
    return (
      <p role="alert" className="text-rose-700">
        Konnte Sitzungen nicht laden: {(error as Error).message}
      </p>
    );
  }
  if (!data) return null;

  const others = data.sessions.filter((s) => !s.current);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Aktive Sitzungen</h2>
        <p className="text-sm text-stone-600">
          Hier siehst du alle Geräte/Browser, bei denen dein Konto eingeloggt ist. Bei Verdacht auf
          unbefugten Zugriff: „Alle anderen abmelden" beendet sofort alle anderen Sitzungen.
        </p>
      </header>

      <ul className="space-y-2">
        {data.sessions.map((s) => (
          <li
            key={s.id}
            className={`rounded border px-4 py-3 ${
              s.current
                ? "border-jass-yellowDark bg-jass-cream"
                : "border-jass-paperEdge bg-jass-paper"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-jass-ink">
                    {s.userAgent ?? "Unbekanntes Gerät"}
                  </span>
                  {s.current && (
                    <span className="rounded bg-jass-yellow border border-jass-yellowDark px-2 py-0.5 text-xs">
                      diese Sitzung
                    </span>
                  )}
                </div>
                <p className="text-xs text-jass-inkSoft">
                  {s.ipPrefix ?? "IP unbekannt"} · zuletzt aktiv{" "}
                  {new Date(s.updatedAt).toLocaleString("de-AT")} · läuft ab{" "}
                  {new Date(s.expiresAt).toLocaleDateString("de-AT")}
                </p>
              </div>
              {!s.current && (
                <button
                  type="button"
                  onClick={() => revoke.mutate(s.id)}
                  disabled={revoke.isPending}
                  className="btn-jass-secondary text-sm"
                >
                  Abmelden
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {others.length > 0 && (
        <section className="border-t border-jass-paperEdge pt-4 space-y-2">
          {!confirmAll ? (
            <button
              type="button"
              onClick={() => setConfirmAll(true)}
              className="rounded border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm text-rose-800 hover:bg-rose-100"
            >
              Alle anderen abmelden ({others.length})
            </button>
          ) : (
            <div className="rounded border border-rose-300 bg-rose-50 p-3 space-y-2">
              <p className="text-sm text-rose-900">
                Wirklich alle anderen <strong>{others.length}</strong> Sitzungen beenden?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    revokeAll.mutate();
                    setConfirmAll(false);
                  }}
                  disabled={revokeAll.isPending}
                  className="rounded bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-700"
                >
                  Ja, alle abmelden
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAll(false)}
                  className="btn-jass-secondary text-sm"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
