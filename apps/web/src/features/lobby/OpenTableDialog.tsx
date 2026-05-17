/**
 * Dialog zum Öffnen eines neuen Tisches.
 *
 * Owner-Optionen (alle aus M6-A/B/E):
 *   - JoinMode: OPEN / REQUEST / INVITE
 *   - KI-Typ (Default „random"; M5-NN ist da, aber für Anfänger erstmal random)
 *   - Auto-Fill-Sekunden: Slider 0 (=null/aus) … 300
 *   - Restart-Mode: WELI / SIEGER_GIBT (User-Default: SIEGER_GIBT)
 *   - „Solo gegen 3 KI": Shortcut, der initialAiSeats auf [1,2,3] setzt
 *
 * Wir nutzen Radix nicht für den Dialog selbst (zu viel Set-up für ein
 * einzelnes Modal in M7-C). Ein einfacher `<dialog>`-Element-basierter
 * Modal genügt — der ist native a11y-fähig (Esc, Fokus-Trap durch Browser).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { api, ApiError } from "~/lib/api";
import type { JoinMode, OpenTableDto, RestartMode } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OpenTableDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [joinMode, setJoinMode] = useState<JoinMode>("OPEN");
  const [aiSeatType, setAiSeatType] = useState<"random" | "nn">("random");
  const [autoFill, setAutoFill] = useState<number | null>(30);
  const [restartMode, setRestartMode] = useState<RestartMode>("SIEGER_GIBT");
  const [soloVsAi, setSoloVsAi] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // open/close ↔ <dialog> öffnen/schließen synchronisieren
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const openMut = useMutation({
    mutationFn: (dto: OpenTableDto) =>
      api<{ tableId: string }>("/api/lobby/tables", { method: "POST", body: dto }),
    onSuccess: ({ tableId }) => {
      queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
      onClose();
      void navigate({ to: "/table/$id", params: { id: tableId } });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Tisch konnte nicht geöffnet werden.");
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const dto: OpenTableDto = {
      joinMode,
      aiSeatType,
      autoFillSeconds: autoFill,
      restartMode,
      initialAiSeats: soloVsAi ? [{ seat: 1 }, { seat: 2 }, { seat: 3 }] : [],
    };
    openMut.mutate(dto);
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-lg p-0 backdrop:bg-stone-900/40 w-full max-w-md"
    >
      <form onSubmit={submit} className="p-6 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Neuen Tisch öffnen</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="text-stone-500 hover:text-stone-900 text-xl"
          >
            ×
          </button>
        </header>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-stone-700">Beitritts-Modus</legend>
          {(
            [
              ["OPEN", "Offen — jeder darf rein"],
              ["REQUEST", "Auf Anfrage — du genehmigst"],
              ["INVITE", "Nur per Einladung"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="joinMode"
                value={value}
                checked={joinMode === value}
                onChange={() => setJoinMode(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <label className="block">
          <span className="block text-sm font-medium text-stone-700 mb-1">KI-Typ (Default)</span>
          <select
            value={aiSeatType}
            onChange={(e) => setAiSeatType(e.target.value as "random" | "nn")}
            className="w-full rounded border border-stone-300 px-3 py-2"
          >
            <option value="random">Zufall (schnell, Baseline)</option>
            <option value="nn">Neuronales Netz (stärker, braucht Inferenz-Service)</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-stone-700 mb-1">
            Auto-Fill nach (0 = aus): {autoFill === null ? "aus" : `${autoFill}s`}
          </span>
          <input
            type="range"
            min={0}
            max={300}
            step={5}
            value={autoFill ?? 0}
            onChange={(e) => {
              const n = Number(e.target.value);
              setAutoFill(n === 0 ? null : n);
            }}
            className="w-full"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-stone-700">Re-Match: wer beginnt?</legend>
          {(
            [
              ["SIEGER_GIBT", "Sieger gibt — der Verlierer kommt raus"],
              ["WELI", "Welli ausspielen — wer das Welli hat, beginnt"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="restartMode"
                value={value}
                checked={restartMode === value}
                onChange={() => setRestartMode(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2 text-sm border-t border-stone-200 pt-3">
          <input
            type="checkbox"
            checked={soloVsAi}
            onChange={(e) => setSoloVsAi(e.target.checked)}
          />
          Direkt allein gegen 3 KI starten (Sitze 1–3 werden mit dem KI-Default belegt)
        </label>

        {error && (
          <div
            role="alert"
            className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
          >
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end border-t border-stone-200 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-stone-300 px-4 py-2 text-stone-700 hover:bg-stone-100"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={openMut.isPending}
            className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {openMut.isPending ? "Öffne …" : "Tisch öffnen"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
