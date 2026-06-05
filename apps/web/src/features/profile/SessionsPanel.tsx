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
import { Trans, useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
        {t("profile.sessions.loadError", { message: (error as Error).message })}
      </p>
    );
  }
  if (!data) return null;

  const others = data.sessions.filter((s) => !s.current);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t("profile.sessions.title")}</h2>
        <p className="text-sm text-stone-600">{t("profile.sessions.intro")}</p>
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
                    {s.userAgent ?? t("profile.sessions.unknownDevice")}
                  </span>
                  {s.current && (
                    <span className="rounded bg-jass-yellow border border-jass-yellowDark px-2 py-0.5 text-xs">
                      {t("profile.sessions.thisSession")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-jass-inkSoft">
                  {s.ipPrefix ?? t("profile.sessions.ipUnknown")} ·{" "}
                  {t("profile.sessions.lastActive", {
                    date: new Date(s.updatedAt).toLocaleString("de-AT"),
                  })}{" "}
                  ·{" "}
                  {t("profile.sessions.expires", {
                    date: new Date(s.expiresAt).toLocaleDateString("de-AT"),
                  })}
                </p>
              </div>
              {!s.current && (
                <button
                  type="button"
                  onClick={() => revoke.mutate(s.id)}
                  disabled={revoke.isPending}
                  className="btn-jass-secondary text-sm"
                >
                  {t("profile.sessions.signOut")}
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
              {t("profile.sessions.signOutOthers", { count: others.length })}
            </button>
          ) : (
            <div className="rounded border border-rose-300 bg-rose-50 p-3 space-y-2">
              <p className="text-sm text-rose-900">
                <Trans
                  i18nKey="profile.sessions.confirmAll"
                  values={{ count: others.length }}
                  components={{ strong: <strong /> }}
                />
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
                  {t("profile.sessions.confirmAllYes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAll(false)}
                  className="btn-jass-secondary text-sm"
                >
                  {t("profile.sessions.cancel")}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
