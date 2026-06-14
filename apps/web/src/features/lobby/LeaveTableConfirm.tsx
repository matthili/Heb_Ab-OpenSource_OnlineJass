/**
 * Bestätigungs-Dialog vor dem Tisch-Verlassen.
 *
 * Verhalten je nach Tisch-Status:
 *
 *   - WAITING: Verlassen ist unkritisch — nur Hinweis, dass der Sitz
 *     freigegeben wird. Konsistente UI > ein Click-Ersparnis.
 *   - IN_GAME / POST_GAME: Aussteig ist möglich (`/api/lobby/tables/:id/leave`);
 *     der Server ersetzt den Sitz durch eine KI, das Spiel läuft weiter. Das
 *     wird dem User klar angesagt und im Audit-Log vermerkt (Quitter-Tracking).
 *
 * **Nicht hier**: eine passive „60 s Lobby-Ausflug + 20 s ‚Bist du noch da?'"-
 * Mechanik (Soft-Navigation ohne Verlassen-Click) ist in `PLAN.md` §14 als
 * Backlog-Punkt geführt — anderes Feature als die WS-Disconnect-Vote-Logik.
 */
import { useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { LobbyStatus } from "./types";

interface Props {
  open: boolean;
  tableStatus: LobbyStatus;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Owner-Variante „Tisch auflösen" (schließt für alle) statt „verlassen". */
  dissolve?: boolean;
}

export function LeaveTableConfirm({
  open,
  tableStatus,
  pending,
  onCancel,
  onConfirm,
  dissolve = false,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const isInGame = tableStatus === "IN_GAME" || tableStatus === "POST_GAME";

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="rounded-lg p-0 backdrop:bg-black/40 w-full max-w-md bg-jass-paper text-jass-ink"
    >
      <div className="p-6 space-y-4">
        <h2 className="text-xl font-bold text-jass-ink">
          {dissolve ? t("lobby.dissolve.confirmTitle") : t("lobby.leave.confirmTitle")}
        </h2>

        {dissolve ? (
          <p className="text-sm text-rose-900">
            <Trans i18nKey="lobby.dissolve.confirmBody" components={{ strong: <strong /> }} />
          </p>
        ) : isInGame ? (
          <>
            <p className="text-sm text-jass-inkSoft">
              <Trans i18nKey="lobby.leave.inGameIntro" components={{ strong: <strong /> }} />
            </p>
            <p className="text-sm text-rose-900">
              <Trans i18nKey="lobby.leave.inGameWarning" components={{ strong: <strong /> }} />
            </p>
            <p className="text-sm text-jass-inkSoft">
              <Trans i18nKey="lobby.leave.inGameAlternative" components={{ em: <em /> }} />
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-jass-inkSoft">{t("lobby.leave.waitingIntro")}</p>
            <p className="text-sm text-jass-inkSoft">{t("lobby.leave.waitingConfirm")}</p>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-jass-paperEdge pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-jass-paperEdge px-4 py-2 text-jass-ink hover:bg-jass-paper"
          >
            {t("lobby.leave.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded bg-jass-red px-4 py-2 text-jass-cream hover:bg-jass-redDark disabled:opacity-50"
          >
            {pending
              ? dissolve
                ? t("lobby.dissolve.dissolving")
                : t("lobby.leave.leaving")
              : dissolve
                ? t("lobby.dissolve.confirm")
                : isInGame
                  ? t("lobby.leave.confirmInGame")
                  : t("lobby.leave.confirmWaiting")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
