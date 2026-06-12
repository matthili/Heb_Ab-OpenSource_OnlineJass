/**
 * Liste der gerade im System verbundenen User („wer ist online?").
 *
 * Quelle: `GET /api/lobby/presence` — polled alle 15 s, kein WS-Push
 * (die Liste ist nicht zeitkritisch genug für eine eigene Subscription).
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { UserName } from "~/features/social/UserName";
import { api } from "~/lib/api";

interface PresenceUser {
  id: string;
  name: string;
}

const POLL_MS = 15_000;

export function OnlineUsersPanel() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery<{ users: PresenceUser[] }>({
    queryKey: ["lobby", "presence"],
    queryFn: () => api("/api/lobby/presence"),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });

  if (isPending) {
    return (
      <aside className="rounded border border-jass-paperEdge bg-jass-paper p-3 text-sm">
        <p className="text-jass-inkSoft">{t("lobby.onlineUsers.loading")}</p>
      </aside>
    );
  }
  if (isError || !data) {
    return null; // still — Online-Liste ist nicht kritisch
  }

  return (
    <aside className="rounded border border-jass-paperEdge bg-jass-paper p-3 text-sm">
      <h3 className="font-semibold mb-2 text-jass-ink">
        {t("lobby.onlineUsers.heading")}{" "}
        <span className="text-jass-inkSoft font-normal">({data.users.length})</span>
      </h3>
      {data.users.length === 0 ? (
        <p className="text-jass-inkSoft italic">{t("lobby.onlineUsers.none")}</p>
      ) : (
        <ul className="space-y-0.5 max-h-48 overflow-y-auto">
          {data.users.map((u) => (
            <li key={u.id} className="flex items-center gap-2 text-jass-ink">
              <span
                title={t("social.presence.online")}
                aria-label={t("social.presence.online")}
                className="inline-block size-2 rounded-full bg-emerald-500"
              />
              <UserName userId={u.id} name={u.name} showPresence={false} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
