/**
 * Bodensee 2-Spieler: Der (einzige) Gegner hat den Tisch mitten im Spiel
 * verlassen — die KI hat seinen Sitz übernommen. Der verbleibende Spieler
 * wählt hier: ebenfalls gehen oder gegen den Computer fertig spielen, damit die
 * Partie vollständig in seiner Statistik landet.
 *
 * Eigener Dialog statt `ConfirmDialog`, weil hier das „fertig spielen" die
 * betonte (primäre) UND Escape-/Backdrop-sichere Aktion sein soll — nicht das
 * Verlassen. Natives `<dialog>` (Muster von `ConfirmDialog`): Fokus-Falle,
 * Escape und Backdrop gratis; Escape/Backdrop → `onPlayOn` (die sichere Wahl).
 */
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";

import { shortName } from "~/features/game/aiNames";
import { api } from "~/lib/api";

export function OpponentLeftDialog({
  open,
  name,
  reason,
  tableId,
  onPlayOn,
}: {
  open: boolean;
  /** Anzeigename des Aussteigers (FE setzt einen generischen Fallback, falls
   *  der Server keinen liefern konnte). */
  name: string;
  /** Warum der Gegner weg ist — steuert den Wortlaut (verlassen vs. Timeout). */
  reason: "left" | "timeout";
  tableId: string;
  /** „Gegen den Computer fertig spielen" — Dialog schließen, weiterspielen. */
  onPlayOn: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const leaveMut = useMutation({
    mutationFn: () => api(`/api/lobby/tables/${tableId}/leave`, { method: "POST" }),
    // Egal ob 200 oder „bin eh schon weg" (404/409): Intent erfüllt → Lobby.
    onSettled: () => void navigate({ to: "/lobby" }),
  });

  const titleKey =
    reason === "timeout" ? "bodensee.opponentLeft.titleTimeout" : "bodensee.opponentLeft.titleLeft";
  const bodyKey =
    reason === "timeout" ? "bodensee.opponentLeft.bodyTimeout" : "bodensee.opponentLeft.bodyLeft";

  return (
    <dialog
      ref={ref}
      onClose={onPlayOn}
      className="w-full max-w-md rounded-lg bg-jass-paper p-0 text-jass-ink backdrop:bg-black/40"
    >
      <div className="space-y-4 p-6">
        <h2 className="text-xl font-bold text-jass-ink">{t(titleKey)}</h2>
        <p className="text-sm text-jass-inkSoft">
          <Trans
            i18nKey={bodyKey}
            values={{ name: shortName(name) }}
            components={{ n: <span className="font-semibold text-jass-ink" /> }}
          />
        </p>
        <div className="flex flex-col-reverse gap-2 border-t border-jass-paperEdge pt-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => leaveMut.mutate()}
            disabled={leaveMut.isPending}
            className="rounded border border-jass-paperEdge px-4 py-2 text-jass-ink hover:bg-jass-cream disabled:opacity-50"
          >
            {t("bodensee.opponentLeft.leave")}
          </button>
          <button
            type="button"
            onClick={onPlayOn}
            disabled={leaveMut.isPending}
            className="btn-jass-primary rounded px-4 py-2 disabled:opacity-50"
          >
            {t("bodensee.opponentLeft.playOn")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
