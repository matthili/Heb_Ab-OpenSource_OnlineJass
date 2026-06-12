/**
 * Melde-Dialog: erst Kontext (Profil/Chat/Spielverhalten), dann Grund wählen,
 * optional Freitext. Sendet an `POST /api/users/:id/report`.
 */
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "~/lib/api";
import { useToast } from "~/lib/toast";

const CONTEXTS = ["PROFILE", "CHAT", "GAME"] as const;
const REASONS = [
  "RACISM",
  "SEXISM",
  "HARASSMENT",
  "THREATS",
  "VIOLENCE",
  "SPAM",
  "OTHER_ILLEGAL",
  "GAME_DISRUPTION",
] as const;

type Context = (typeof CONTEXTS)[number];
type Reason = (typeof REASONS)[number];

interface Props {
  open: boolean;
  userId: string;
  name: string;
  onClose: () => void;
}

export function ReportDialog({ open, userId, name, onClose }: Props) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (open) {
      setContext(null);
      setReason(null);
      setNote("");
    }
  }, [open]);

  const submit = useMutation({
    mutationFn: () =>
      api(`/api/users/${userId}/report`, {
        method: "POST",
        body: { context, reason, ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    onSuccess: () => {
      showToast(t("social.report.sent"), { variant: "success" });
      onClose();
    },
    onError: (err) =>
      showToast(err instanceof ApiError ? err.message : t("social.report.failed"), {
        variant: "error",
      }),
  });

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="w-full max-w-md rounded-lg bg-jass-paper p-0 text-jass-ink backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (context && reason) submit.mutate();
        }}
        className="space-y-4 p-6"
      >
        <h2 className="text-xl font-bold">{t("social.report.title", { name })}</h2>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t("social.report.contextLabel")}</legend>
          <div className="flex flex-wrap gap-2">
            {CONTEXTS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setContext(c)}
                aria-pressed={context === c}
                className={`rounded-full border px-3 py-1 text-sm ${
                  context === c
                    ? "border-jass-yellowDark bg-jass-yellow font-semibold"
                    : "border-jass-paperEdge bg-jass-cream"
                }`}
              >
                {t(`social.report.context.${c}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t("social.report.reasonLabel")}</legend>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                aria-pressed={reason === r}
                className={`rounded-full border px-3 py-1 text-sm ${
                  reason === r
                    ? "border-jass-yellowDark bg-jass-yellow font-semibold"
                    : "border-jass-paperEdge bg-jass-cream"
                }`}
              >
                {t(`social.report.reason.${r}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block space-y-1">
          <span className="text-sm font-semibold">{t("social.report.noteLabel")}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={t("social.report.notePlaceholder")}
            className="w-full rounded border border-jass-paperEdge bg-jass-cream px-2 py-1 text-sm"
          />
        </label>

        <div className="flex justify-end gap-2 border-t border-jass-paperEdge pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-jass-paperEdge px-4 py-2 hover:bg-jass-cream"
          >
            {t("social.cancel")}
          </button>
          <button
            type="submit"
            disabled={!context || !reason || submit.isPending}
            className="rounded bg-jass-red px-4 py-2 text-jass-cream hover:bg-jass-redDark disabled:opacity-50"
          >
            {t("social.report.submit")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
