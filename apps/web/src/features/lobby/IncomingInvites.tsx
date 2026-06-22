/**
 * Bleibende Liste der **eingehenden** Tisch-Einladungen für den eingeloggten
 * User. Bisher kam eine Einladung nur als flüchtiger Toast — wer den verpasste
 * (oder gerade nicht verbunden war), sah nichts mehr. Diese Liste holt die
 * offenen Einladungen per REST und aktualisiert sich zusätzlich live über das
 * `lobby:invite-received`-WS-Event.
 *
 * Pro Einladung: **Beitreten** (accept → Tisch öffnen) oder **Ablehnen**
 * (decline). Fehler (z.B. Tisch inzwischen voll) erscheinen als Toast.
 * Ist nichts offen, rendert die Komponente nichts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "~/lib/api";
import { useToast } from "~/lib/toast";
import { useUserEvents } from "~/lib/ws";

interface IncomingInvite {
  inviteId: string;
  tableId: string;
  variant: string;
  inviterName: string;
  createdAt: string;
}

const QUERY_KEY = ["lobby", "invites", "incoming"] as const;

export function IncomingInvites() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api<{ invites: IncomingInvite[] }>("/api/lobby/invites/incoming"),
  });

  // Neue ODER zurückgezogene Einladung per WS → Liste sofort neu laden (Handler
  // stabil halten, useUserEvents re-subscribed sonst bei jedem Render). Das
  // Backend pusht `lobby:invite-cancelled` an den Eingeladenen, wenn der Owner
  // die Einladung zurückzieht — sonst bliebe sie hier stehen.
  const refreshInvites = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);
  useUserEvents("lobby:invite-received", refreshInvites);
  useUserEvents("lobby:invite-cancelled", refreshInvites);

  const accept = useMutation({
    mutationFn: (inv: IncomingInvite) =>
      api(`/api/lobby/tables/${inv.tableId}/invites/${inv.inviteId}/accept`, { method: "POST" }),
    onSuccess: (_res, inv) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      void navigate({ to: "/table/$id", params: { id: inv.tableId } });
    },
    onError: (err) =>
      showToast(
        t("lobby.incomingInvites.acceptFailed", {
          message: err instanceof ApiError ? err.message : "",
        }),
        { variant: "error" }
      ),
  });

  const decline = useMutation({
    mutationFn: (inv: IncomingInvite) =>
      api(`/api/lobby/tables/${inv.tableId}/invites/${inv.inviteId}/decline`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: () => showToast(t("lobby.incomingInvites.declineFailed"), { variant: "error" }),
  });

  const invites = data?.invites ?? [];
  if (invites.length === 0) return null;

  const busy = accept.isPending || decline.isPending;

  return (
    <section className="space-y-2 rounded-lg border border-jass-yellowDark bg-jass-yellow/15 p-3">
      <h2 className="text-sm font-semibold text-jass-ink">{t("lobby.incomingInvites.title")}</h2>
      <ul className="space-y-2">
        {invites.map((inv) => (
          <li
            key={inv.inviteId}
            className="flex flex-wrap items-center gap-3 rounded border border-jass-paperEdge bg-jass-paper px-3 py-2"
          >
            <span className="flex-1 text-sm text-jass-ink">
              {t("lobby.incomingInvites.from", { name: inv.inviterName })}
            </span>
            <button
              type="button"
              onClick={() => accept.mutate(inv)}
              disabled={busy}
              className="btn-jass-primary text-sm disabled:opacity-50"
            >
              {t("lobby.incomingInvites.accept")}
            </button>
            <button
              type="button"
              onClick={() => decline.mutate(inv)}
              disabled={busy}
              className="btn-jass-secondary text-sm disabled:opacity-50"
            >
              {t("lobby.incomingInvites.decline")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
