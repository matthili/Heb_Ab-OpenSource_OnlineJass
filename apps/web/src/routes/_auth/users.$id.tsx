/**
 * Fremdes Profil — pro-Feld nach Vier-Stufen-Sichtbarkeit gefiltert.
 *
 * Backend liefert nur die Felder, die der Viewer sehen darf. Wir
 * brauchen also kein zweites Filter-Layer hier; wir zeigen nur, was
 * nicht-null reinkommt. Felder, die der Profil-Inhaber privat hält,
 * tauchen gar nicht erst auf.
 *
 * Friend-Status:
 *   - Eigene Sicht (`isSelf`): kein Friend-Button — Link „Profil bearbeiten" stattdessen.
 *   - NONE: „Freundschaft anfragen"
 *   - PENDING_OUT: „Anfrage ausstehend (zurückziehen)"
 *   - PENDING_IN:  „… hat dir eine Anfrage geschickt — Annehmen / Ablehnen"
 *   - ACCEPTED:    „Befreundet — Entfreunden"
 *   - BLOCKED:     ohne Button (Server liefert ggf. 404)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { StatsTable, type UserStatsData } from "~/features/profile/UserStatsPanel";
import { api, ApiError } from "~/lib/api";
import { useSession } from "~/lib/auth-client";
import { useDmWindows } from "~/lib/dm-windows";

export const Route = createFileRoute("/_auth/users/$id")({
  component: PublicProfilePage,
});

interface PublicProfileView {
  id: string;
  name: string;
  realFirstName: string | null;
  realLastName: string | null;
  birthDate: string | null; // ISO date
  city: string | null;
  country: string | null;
  hobbies: string | null;
  bio: string | null;
  avatarUrl: string | null;
  /** Spiel-Statistik — nur gesetzt, wenn die Sichtbarkeit es erlaubt. */
  stats: UserStatsData | null;
}

type FriendStatus = "NONE" | "PENDING_OUT" | "PENDING_IN" | "ACCEPTED" | "BLOCKED";

interface FriendStatusView {
  status: FriendStatus;
}

function PublicProfilePage() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const { data: session } = useSession();
  const myId = session?.user?.id;
  const isSelf = myId === id;
  const { open: openDm } = useDmWindows();

  const { data, isPending, error } = useQuery<PublicProfileView>({
    queryKey: ["users", "public", id],
    queryFn: () => api<PublicProfileView>(`/api/users/${id}`),
  });

  if (isPending) return <p className="text-stone-500">…</p>;
  if (error) {
    return (
      <p role="alert" className="text-rose-700">
        {t("profile.publicProfile.notFound", { message: (error as Error).message })}
      </p>
    );
  }
  if (!data) return null;

  const realName = [data.realFirstName, data.realLastName].filter(Boolean).join(" ");
  const place = [data.city, data.country].filter(Boolean).join(", ");

  return (
    <article className="max-w-2xl space-y-5">
      <header className="flex items-start gap-4">
        {data.avatarUrl ? (
          <img
            src={data.avatarUrl}
            alt=""
            className="w-20 h-20 rounded-full object-cover border border-jass-paperEdge"
          />
        ) : (
          <div
            aria-hidden="true"
            className="w-20 h-20 rounded-full bg-jass-cream border border-jass-paperEdge flex items-center justify-center text-2xl font-bold text-jass-inkSoft"
          >
            {data.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-jass-ink">{data.name}</h1>
          {realName.length > 0 && <p className="text-jass-inkSoft">{realName}</p>}
          {place.length > 0 && <p className="text-sm text-jass-inkSoft">{place}</p>}
        </div>
        <div className="ml-auto flex flex-col items-end gap-2">
          {isSelf ? (
            <Link to="/profile" search={{ tab: "edit" }} className="btn-jass-secondary text-sm">
              {t("profile.publicProfile.editProfile")}
            </Link>
          ) : myId ? (
            <>
              <FriendButton targetId={id} />
              <button
                type="button"
                onClick={() => openDm(id, data.name)}
                className="btn-jass-secondary text-sm"
              >
                {t("profile.publicProfile.sendMessage")}
              </button>
            </>
          ) : null}
        </div>
      </header>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {data.birthDate && (
          <Row label={t("profile.publicProfile.birthDate")}>
            {new Date(data.birthDate).toLocaleDateString("de-AT")}
          </Row>
        )}
        {data.hobbies && <Row label={t("profile.publicProfile.hobbies")}>{data.hobbies}</Row>}
        {data.bio && (
          <Row label={t("profile.publicProfile.bio")} full>
            <p className="whitespace-pre-wrap">{data.bio}</p>
          </Row>
        )}
      </dl>

      {data.stats && data.stats.totals.gamesPlayed > 0 && <StatsTable stats={data.stats} />}

      {!realName &&
        !place &&
        !data.birthDate &&
        !data.hobbies &&
        !data.bio &&
        !(data.stats && data.stats.totals.gamesPlayed > 0) && (
          <p className="text-sm italic text-jass-inkSoft">
            {t("profile.publicProfile.noPublicFields")}
          </p>
        )}
    </article>
  );
}

function Row({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-xs uppercase tracking-wide text-jass-inkSoft">{label}</dt>
      <dd className="text-jass-ink">{children}</dd>
    </div>
  );
}

/**
 * Friend-Button mit Statemachine. Lädt Status, rendert passenden Button.
 * Aktionen invalidieren beide Queries (eigener Status + Counter im Profil-Tab).
 */
function FriendButton({ targetId }: { targetId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const statusKey = ["friends", "status", targetId] as const;

  const { data } = useQuery<FriendStatusView>({
    queryKey: statusKey,
    queryFn: () => api<FriendStatusView>(`/api/users/${targetId}/friend-status`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: statusKey });
    void queryClient.invalidateQueries({ queryKey: ["friends", "list"] });
  };

  const request = useMutation({
    mutationFn: () => api(`/api/users/${targetId}/friend-request`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const accept = useMutation({
    mutationFn: () => api(`/api/users/${targetId}/friend-accept`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/users/${targetId}/friend`, { method: "DELETE", raw: true }),
    onSuccess: invalidate,
  });

  if (!data) return null;

  const errMsg =
    request.error instanceof ApiError
      ? request.error.message
      : accept.error instanceof ApiError
        ? accept.error.message
        : remove.error instanceof ApiError
          ? remove.error.message
          : null;

  return (
    <div className="space-y-1">
      {data.status === "NONE" && (
        <button
          type="button"
          onClick={() => request.mutate()}
          disabled={request.isPending}
          className="btn-jass-primary text-sm"
        >
          {request.isPending
            ? t("profile.publicProfile.sending")
            : t("profile.publicProfile.requestFriendship")}
        </button>
      )}
      {data.status === "PENDING_OUT" && (
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="btn-jass-secondary text-sm"
        >
          {remove.isPending ? "…" : t("profile.publicProfile.withdrawRequest")}
        </button>
      )}
      {data.status === "PENDING_IN" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => accept.mutate()}
            disabled={accept.isPending}
            className="btn-jass-primary text-sm"
          >
            {accept.isPending ? "…" : t("profile.publicProfile.accept")}
          </button>
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="btn-jass-secondary text-sm"
          >
            {t("profile.publicProfile.decline")}
          </button>
        </div>
      )}
      {data.status === "ACCEPTED" && (
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="btn-jass-secondary text-sm"
        >
          {remove.isPending ? "…" : t("profile.publicProfile.unfriend")}
        </button>
      )}
      {errMsg && (
        <p role="alert" className="text-xs text-rose-700">
          {errMsg}
        </p>
      )}
    </div>
  );
}
