/**
 * „Freunde"-Tab im Profil.
 *
 * Drei Sektionen:
 *   - Eingegangene Anfragen (Annehmen/Ablehnen direkt)
 *   - Bestätigte Freunde (Profil öffnen / Entfreunden)
 *   - Eigene ausgehende Anfragen (Zurückziehen)
 *
 * Bewusst keine eigene Search/Add-Funktion an dieser Stelle —
 * Freundschaftsanfragen werden auf der Profil-Seite des anderen Users
 * (z.B. via Klick auf den Sitz-Namen am Tisch) ausgelöst. Das vermeidet
 * versehentliches „Massen-Adden" und macht die Identität des Gegenübers
 * immer sichtbar.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BirthdayReminder } from "~/features/social/BirthdayReminder";
import { ConfirmDialog } from "~/features/social/ConfirmDialog";
import { UserName } from "~/features/social/UserName";
import { api } from "~/lib/api";

interface FriendListEntry {
  id: string;
  name: string;
  avatarUrl: string | null;
  since: string;
}

interface FriendsList {
  accepted: FriendListEntry[];
  pendingIn: FriendListEntry[];
  pendingOut: FriendListEntry[];
}

export function FriendsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["friends", "list"] as const;
  const [unfriendTarget, setUnfriendTarget] = useState<{ id: string; name: string } | null>(null);
  const { data, isPending, error } = useQuery<FriendsList>({
    queryKey,
    queryFn: () => api<FriendsList>("/api/users/me/friends"),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["friends", "status"] });
  };

  const accept = useMutation({
    mutationFn: (otherId: string) => api(`/api/users/${otherId}/friend-accept`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (otherId: string) =>
      api(`/api/users/${otherId}/friend`, { method: "DELETE", raw: true }),
    onSuccess: invalidate,
  });

  if (isPending) return <p className="text-stone-500">…</p>;
  if (error) {
    return (
      <p role="alert" className="text-rose-700">
        {t("profile.friends.loadError", { message: (error as Error).message })}
      </p>
    );
  }
  if (!data) return null;

  const empty =
    data.accepted.length === 0 && data.pendingIn.length === 0 && data.pendingOut.length === 0;

  return (
    <div className="space-y-6">
      <BirthdayReminder />
      {data.pendingIn.length > 0 && (
        <Section title={t("profile.friends.pendingInTitle", { count: data.pendingIn.length })}>
          <ul className="space-y-2">
            {data.pendingIn.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded border border-jass-paperEdge bg-jass-paper px-3 py-2"
              >
                <Avatar entry={u} />
                <UserName userId={u.id} name={u.name} className="font-medium text-jass-ink" />
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => accept.mutate(u.id)}
                    disabled={accept.isPending}
                    className="btn-jass-primary text-sm"
                  >
                    {t("profile.friends.accept")}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutate(u.id)}
                    disabled={remove.isPending}
                    className="btn-jass-secondary text-sm"
                  >
                    {t("profile.friends.decline")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("profile.friends.acceptedTitle", { count: data.accepted.length })}>
        {data.accepted.length === 0 ? (
          <p className="text-sm italic text-jass-inkSoft">{t("profile.friends.noFriendsHint")}</p>
        ) : (
          <ul className="space-y-2">
            {data.accepted.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded border border-jass-paperEdge bg-jass-paper px-3 py-2"
              >
                <Avatar entry={u} />
                <UserName userId={u.id} name={u.name} className="font-medium text-jass-ink" />
                <span className="text-xs text-jass-inkSoft ml-2">
                  {t("profile.friends.since", {
                    date: new Date(u.since).toLocaleDateString("de-AT"),
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setUnfriendTarget({ id: u.id, name: u.name })}
                  disabled={remove.isPending}
                  className="ml-auto btn-jass-secondary text-sm"
                >
                  {t("profile.friends.unfriend")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data.pendingOut.length > 0 && (
        <Section title={t("profile.friends.pendingOutTitle", { count: data.pendingOut.length })}>
          <ul className="space-y-2">
            {data.pendingOut.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded border border-jass-paperEdge bg-jass-paper px-3 py-2"
              >
                <Avatar entry={u} />
                <UserName userId={u.id} name={u.name} className="font-medium text-jass-ink" />
                <button
                  type="button"
                  onClick={() => remove.mutate(u.id)}
                  disabled={remove.isPending}
                  className="ml-auto btn-jass-secondary text-sm"
                >
                  {t("profile.friends.withdraw")}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {empty && (
        <p className="text-sm italic text-jass-inkSoft">{t("profile.friends.emptyHint")}</p>
      )}

      <ConfirmDialog
        open={unfriendTarget !== null}
        title={t("profile.friends.unfriendConfirmTitle")}
        message={t("profile.friends.unfriendConfirmMessage", { name: unfriendTarget?.name ?? "" })}
        confirmLabel={t("profile.friends.unfriend")}
        cancelLabel={t("social.cancel")}
        pending={remove.isPending}
        danger
        onCancel={() => setUnfriendTarget(null)}
        onConfirm={() => {
          if (unfriendTarget) remove.mutate(unfriendTarget.id);
          setUnfriendTarget(null);
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-jass-ink">{title}</h2>
      {children}
    </section>
  );
}

function Avatar({ entry }: { entry: FriendListEntry }) {
  if (entry.avatarUrl) {
    return (
      <img
        src={entry.avatarUrl}
        alt=""
        className="w-10 h-10 rounded-full object-cover border border-jass-paperEdge"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="w-10 h-10 rounded-full bg-jass-cream border border-jass-paperEdge flex items-center justify-center text-sm font-bold text-jass-inkSoft"
    >
      {entry.name.slice(0, 1).toUpperCase()}
    </div>
  );
}
