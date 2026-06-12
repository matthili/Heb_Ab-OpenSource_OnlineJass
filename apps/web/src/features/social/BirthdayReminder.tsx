/**
 * Dezente Geburtstags-Erinnerung: zeigt Freunde, die **heute** Geburtstag
 * haben (server-seitig ermittelt, respektiert die `birthDate`-Sichtbarkeit).
 * Rendert nichts, wenn niemand Geburtstag hat. Namen sind klickbar (`UserName`)
 * → direkt gratulieren per PN.
 *
 * Eingehängt in der Freunde-Seite und der Lobby.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { UserName } from "~/features/social/UserName";
import { api } from "~/lib/api";

interface BirthdayFriend {
  id: string;
  name: string;
}

export function BirthdayReminder({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const { data } = useQuery<{ friends: BirthdayFriend[] }>({
    queryKey: ["friends", "birthdays-today"],
    queryFn: () => api("/api/users/me/friends/birthdays-today"),
    staleTime: 60 * 60 * 1000, // 1 h — Geburtstage ändern sich nicht stündlich
  });
  const friends = data?.friends ?? [];
  if (friends.length === 0) return null;

  return (
    <div
      className={
        "flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 " +
        className
      }
    >
      <span aria-hidden="true">🎂</span>
      <span className="font-medium">{t("social.birthday.today")}</span>
      {friends.map((f, i) => (
        <span key={f.id}>
          <UserName userId={f.id} name={f.name} className="font-medium" />
          {i < friends.length - 1 ? "," : ""}
        </span>
      ))}
    </div>
  );
}
