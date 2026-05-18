/**
 * Bestätigungs-Dialog vor dem Tisch-Verlassen.
 *
 * **Heute**: einfacher modaler Dialog mit Warnung. Verhalten je nach
 * Tisch-Status:
 *
 *   - WAITING: Verlassen ist unkritisch — nur Hinweis, dass der Sitz
 *     freigegeben wird. Optional könnte das auch übersprungen werden,
 *     aber konsistente UI ist mir wichtiger als ein Click-Ersparnis.
 *   - IN_GAME / POST_GAME: Server blockt aktuell mit 409. Wir zeigen
 *     den Dialog trotzdem mit klarem Hinweis, dass aus laufenden Spielen
 *     aktuell nicht ausgestiegen werden kann. Wenn der Aussteig-aus-
 *     IN_GAME-Sprint durch ist, ändern wir hier Text + Verhalten.
 *
 * **Geplant für Folge-Sprint** (in TODO im Dialog erwähnt): 60 s Lobby-
 * Ausflug ohne Aussteig (kein Verlassen-Click nötig), dann 20 s
 * „Bist du noch da?"-Modal. Wenn das durch ist, ersetzt es den
 * aktuellen Dialog.
 */
import { useEffect, useRef } from "react";

import type { LobbyStatus } from "./types";

interface Props {
  open: boolean;
  tableStatus: LobbyStatus;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function LeaveTableConfirm({ open, tableStatus, pending, onCancel, onConfirm }: Props) {
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
      className="rounded-lg p-0 backdrop:bg-stone-900/40 w-full max-w-md"
    >
      <div className="p-6 space-y-4">
        <h2 className="text-xl font-bold text-jass-ink">Tisch verlassen?</h2>

        {isInGame ? (
          <>
            <p className="text-sm text-jass-inkSoft">
              Das Spiel <strong>läuft gerade</strong>. Wenn du jetzt aussteigst, übernimmt eine KI
              deinen Sitz und das Spiel läuft ohne dich weiter — deine Mitspieler werden nicht
              unterbrochen.
            </p>
            <p className="text-sm text-rose-900">
              <strong>Bedenke:</strong> Wenn echte Mitspieler dabei sind, verderben Aussteiger ihnen
              den Spaß. Das wird auch im Audit-Log vermerkt.
            </p>
            <p className="text-sm text-jass-inkSoft">
              Alternative: einfach kurz woanders hin navigieren — du findest den Tisch unter{" "}
              <em>„Dein aktiver Tisch"</em> in der Lobby wieder.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-jass-inkSoft">
              Du gibst deinen Sitz frei. Falls du Owner bist, wird der Tisch geschlossen, sobald der
              letzte Mensch weg ist.
            </p>
            <p className="text-sm text-jass-inkSoft">Bist du sicher?</p>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-jass-paperEdge pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-jass-paperEdge px-4 py-2 text-jass-ink hover:bg-jass-paper"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded bg-jass-red px-4 py-2 text-jass-cream hover:bg-jass-redDark disabled:opacity-50"
          >
            {pending
              ? "Verlasse…"
              : isInGame
                ? "Trotzdem aussteigen (KI übernimmt)"
                : "Tisch verlassen"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
