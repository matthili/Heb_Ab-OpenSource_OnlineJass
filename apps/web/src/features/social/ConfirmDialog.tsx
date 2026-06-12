/**
 * Generischer Bestätigungs-Dialog (natives `<dialog>`, Muster von
 * `LeaveTableConfirm`). Für „Wirklich entfreunden?", „Erlaubnis entziehen?"
 * usw. Steuerung von außen über `open`; Escape/Backdrop schließen (native a11y)
 * lösen `onCancel` aus.
 */
import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Aktion läuft (Button gesperrt). */
  pending?: boolean;
  /** Roter Bestätigungs-Button für destruktive Aktionen. */
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  pending = false,
  danger = false,
  onCancel,
  onConfirm,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="w-full max-w-md rounded-lg bg-jass-paper p-0 text-jass-ink backdrop:bg-black/40"
    >
      <div className="space-y-4 p-6">
        <h2 className="text-xl font-bold text-jass-ink">{title}</h2>
        <p className="text-sm text-jass-inkSoft">{message}</p>
        <div className="flex justify-end gap-2 border-t border-jass-paperEdge pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-jass-paperEdge px-4 py-2 text-jass-ink hover:bg-jass-cream"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`rounded px-4 py-2 disabled:opacity-50 ${
              danger ? "bg-jass-red text-jass-cream hover:bg-jass-redDark" : "btn-jass-primary"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
