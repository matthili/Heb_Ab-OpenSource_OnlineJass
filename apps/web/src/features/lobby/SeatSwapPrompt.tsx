/**
 * Rückfrage-Dialog beim Ziel eines Sitzplatz-Tauschs.
 *
 * Erscheint, wenn der Server `lobby:seat-swap-prompt` auf den eigenen
 * User-Kanal pusht (ein Mitspieler möchte mit dir tauschen). Drei Antworten:
 * wechseln / nicht wechseln / nicht wechseln & nicht mehr fragen. Läuft die
 * 15-s-Frist ab (oder bricht der Anfragende ab → `lobby:seat-swap-cancelled`),
 * schließt der Dialog von selbst — der Server hat dann serverseitig „nicht
 * wechseln" gewertet.
 */
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "~/lib/api";
import { useUserEvents } from "~/lib/ws";
import { useCountdownSeconds } from "./SeatArrangementPanel";
import type { TableDetailView } from "./types";

interface PromptState {
  requesterId: string;
  requesterSeat: number;
  deadline: number;
}

export function SeatSwapPrompt({
  tableId,
  seats,
}: {
  tableId: string;
  seats: TableDetailView["seats"];
}) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  const onPrompt = useCallback(
    (payload: unknown) => {
      const p = payload as Partial<PromptState> & { tableId?: string };
      if (p?.tableId !== tableId) return;
      if (typeof p.requesterId !== "string" || typeof p.deadline !== "number") return;
      setPrompt({
        requesterId: p.requesterId,
        requesterSeat: p.requesterSeat ?? -1,
        deadline: p.deadline,
      });
    },
    [tableId]
  );
  const onCancelled = useCallback(
    (payload: unknown) => {
      if ((payload as { tableId?: string })?.tableId === tableId) setPrompt(null);
    },
    [tableId]
  );
  useUserEvents("lobby:seat-swap-prompt", onPrompt);
  useUserEvents("lobby:seat-swap-cancelled", onCancelled);

  const respondMut = useMutation({
    mutationFn: (answer: "accept" | "decline" | "decline-forever") =>
      api(`/api/lobby/tables/${tableId}/seat-swap/respond`, { method: "POST", body: { answer } }),
    onSettled: () => setPrompt(null),
  });

  const seconds = useCountdownSeconds(prompt?.deadline ?? null);
  // Frist abgelaufen → Dialog schließen (Server hat auto-„nicht wechseln" gewertet).
  useEffect(() => {
    if (prompt && seconds === 0) setPrompt(null);
  }, [prompt, seconds]);

  if (!prompt) return null;
  const requesterName =
    seats.find((s) => s.user?.id === prompt.requesterId)?.user?.name ?? t("lobby.seatSwap.aPlayer");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm space-y-4 rounded-jass bg-white p-5 shadow-xl"
      >
        <h2 className="text-lg font-bold text-stone-900">{t("lobby.seatSwap.promptTitle")}</h2>
        <p className="text-sm text-stone-700">
          {t("lobby.seatSwap.promptBody", { name: requesterName, n: seconds ?? 0 })}
        </p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => respondMut.mutate("accept")}
            disabled={respondMut.isPending}
            className="w-full rounded bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {t("lobby.seatSwap.accept")}
          </button>
          <button
            type="button"
            onClick={() => respondMut.mutate("decline")}
            disabled={respondMut.isPending}
            className="w-full rounded border border-stone-300 px-4 py-2 hover:bg-stone-100 disabled:opacity-50"
          >
            {t("lobby.seatSwap.decline")}
          </button>
          <button
            type="button"
            onClick={() => respondMut.mutate("decline-forever")}
            disabled={respondMut.isPending}
            className="w-full rounded border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-50"
          >
            {t("lobby.seatSwap.declineForever")}
          </button>
        </div>
      </div>
    </div>
  );
}
