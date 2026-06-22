/**
 * Kontextmenü an einem Usernamen (Einfachklick auf `<UserName>`).
 *
 * Punkte: **Privatnachricht** (öffnet DM-Fenster), **Profilseite** (→ /users/:id),
 * **Freundschaft** (status-abhängig über die vorhandenen Friend-Endpunkte).
 * „Melden" kommt mit dem Report-Feature (Phase 3) dazu.
 *
 * Positionierung: fix am Anker (Klickposition). Klick außerhalb / Escape schließt
 * (gleiches Muster wie `SignOutMenu`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "~/lib/api";
import { useDmWindows } from "~/lib/dm-windows";
import { useToast } from "~/lib/toast";

type FriendStatus = "NONE" | "PENDING_OUT" | "PENDING_IN" | "ACCEPTED" | "BLOCKED";

interface Props {
  userId: string;
  name: string;
  anchor: { x: number; y: number };
  onClose: () => void;
  /** Öffnet den Melde-Dialog (in `UserName` gerendert). */
  onReport: () => void;
  /**
   * Owner-Aktion an SEINEM Tisch: diesen Spieler entfernen und für die
   * Tisch-ID sperren. Nur gesetzt, wenn der Betrachter der Tisch-Owner ist und
   * der Spieler entfernbar ist (anderer Mensch, Kreuz/Solo, vor/zwischen Partien).
   */
  kick?: { tableId: string };
}

export function UserContextMenu({ userId, name, anchor, onClose, onReport, kick }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { open: openDm } = useDmWindows();
  const { showToast } = useToast();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const statusKey = ["friends", "status", userId] as const;
  const { data: status } = useQuery<{ status: FriendStatus }>({
    queryKey: statusKey,
    queryFn: () => api(`/api/users/${userId}/friend-status`),
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: statusKey });
    void queryClient.invalidateQueries({ queryKey: ["friends"] });
  };
  const onMutationError = (e: unknown) =>
    showToast(t("social.toast.error", { message: e instanceof ApiError ? e.message : "" }), {
      variant: "error",
    });
  const request = useMutation({
    mutationFn: () => api(`/api/users/${userId}/friend-request`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      showToast(t("social.toast.requestSent"), { variant: "success" });
    },
    onError: onMutationError,
  });
  const accept = useMutation({
    mutationFn: () => api(`/api/users/${userId}/friend-accept`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      showToast(t("social.toast.accepted"), { variant: "success" });
    },
    onError: onMutationError,
  });
  const kickMut = useMutation({
    mutationFn: () =>
      api(`/api/lobby/tables/${kick!.tableId}/kick`, { method: "POST", body: { userId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lobby", "table", kick!.tableId] });
      onClose();
    },
  });

  const itemClass =
    "block w-full whitespace-nowrap px-3 py-2 text-left text-sm text-stone-800 hover:bg-stone-100 disabled:opacity-50";

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={name}
      style={{ left: anchor.x, top: anchor.y }}
      className="fixed z-50 min-w-[12rem] overflow-hidden rounded-md border border-stone-300 bg-white shadow-lg"
    >
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          openDm(userId, name);
          onClose();
        }}
      >
        {t("social.menu.message")}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          void navigate({ to: "/users/$id", params: { id: userId } });
          onClose();
        }}
      >
        {t("social.menu.profile")}
      </button>

      {/* Freundschaft — status-abhängig */}
      {status?.status === "ACCEPTED" ? (
        <div className="bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          ✓ {t("social.menu.areFriends")}
        </div>
      ) : status?.status === "PENDING_OUT" ? (
        <div className="px-3 py-2 text-sm italic text-stone-500">
          {t("social.menu.requestPending")}
        </div>
      ) : status?.status === "PENDING_IN" ? (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          disabled={accept.isPending}
          onClick={() => accept.mutate(undefined, { onSuccess: onClose })}
        >
          {t("social.menu.acceptFriend")}
        </button>
      ) : status?.status === "NONE" ? (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          disabled={request.isPending}
          onClick={() => request.mutate(undefined, { onSuccess: onClose })}
        >
          {t("social.menu.addFriend")}
        </button>
      ) : null}

      <button
        type="button"
        role="menuitem"
        className={`${itemClass} border-t border-stone-100 text-rose-700`}
        onClick={() => {
          onReport();
          onClose();
        }}
      >
        {t("social.menu.report")}
      </button>

      {kick && (
        <button
          type="button"
          role="menuitem"
          className={`${itemClass} border-t border-stone-100 font-medium text-rose-700`}
          disabled={kickMut.isPending}
          onClick={() => kickMut.mutate()}
        >
          {t("social.menu.kickFromTable")}
        </button>
      )}
    </div>
  );
}
