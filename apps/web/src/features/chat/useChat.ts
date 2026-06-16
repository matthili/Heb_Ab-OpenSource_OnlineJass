/**
 * Chat-Hook: lädt Historie via REST, subscribed via WS auf neue
 * Nachrichten, exposed `sendMessage(body)`.
 *
 * **Daten-Modell**:
 *   - Initial-Fetch über `GET /api/chat?channelKey=…&limit=50`.
 *   - WS-Subscribe via `chat:subscribe`-Event → bekommt `chat:message`
 *     pushes.
 *   - Eingehende WS-Messages werden ans Ende der Liste angehängt (mit
 *     Dedup nach `id`, falls Server doppelt liefert).
 *   - Senden via `POST /api/chat`. Wir warten nicht auf den WS-Echo —
 *     die Server-Response wird auch direkt angehängt.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { api } from "~/lib/api";
import { getLobbySocket } from "~/lib/ws";
import type { ChatMessageView } from "./types";

interface HistoryResponse {
  messages: ChatMessageView[];
}

export interface ChatHookValue {
  messages: ChatMessageView[];
  isLoading: boolean;
  error: Error | null;
  sendMessage: (body: string) => Promise<void>;
  isSending: boolean;
  sendError: Error | null;
  /** Ältere Nachrichten nachladen (Pagination via ?before=, vorne anhängen). */
  loadOlder: () => Promise<void>;
  isLoadingOlder: boolean;
  /** true, solange es vermutlich noch ältere Nachrichten zu laden gibt. */
  canLoadOlder: boolean;
}

export function useChat(channelKey: string | null): ChatHookValue {
  const queryClient = useQueryClient();
  const queryKey = ["chat", channelKey] as const;

  const { data, isPending, error } = useQuery<HistoryResponse>({
    queryKey,
    queryFn: () =>
      api<HistoryResponse>(`/api/chat?channelKey=${encodeURIComponent(channelKey!)}&limit=50`),
    enabled: channelKey !== null,
  });

  // WS-Subscribe + Push-Append.
  //
  // **Wichtig — Dependencies:** Hier NUR `channelKey` (+ stabiler
  // `queryClient`). Früher stand `queryKey` mit drin — das ist aber bei jedem
  // Render eine NEUE Array-Referenz (`["chat", channelKey]`), wodurch der
  // Effect bei jedem Render neu lief und im Cleanup `chat:unsubscribe` +
  // danach wieder `chat:subscribe` feuerte. Bei vielen Re-Renders (z.B.
  // laufendes Spiel, Rematch-Countdown) ergab das einen Event-Sturm, der den
  // WS-Rate-Limiter auslöste und am Ende den Socket trennte — wodurch auch
  // `lobby:table-state`/`game:ended` verloren gingen (Tisch wechselte nicht
  // zur neuen Runde). Den Query-Key bilden wir darum lokal inline.
  useEffect(() => {
    if (!channelKey) return;
    const socket = getLobbySocket();
    socket.emit("chat:subscribe", { channelKey });

    function onMessage(view: ChatMessageView) {
      if (view.channelKey !== channelKey) return;
      queryClient.setQueryData<HistoryResponse>(["chat", channelKey], (prev) => {
        const list = prev?.messages ?? [];
        // Dedup nach id — der Server kann via WS push UND als REST-
        // Response liefern.
        if (list.some((m) => m.id === view.id)) return prev ?? { messages: [view] };
        return { messages: [...list, view] };
      });
    }

    socket.on("chat:message", onMessage);
    return () => {
      socket.off("chat:message", onMessage);
      socket.emit("chat:unsubscribe", { channelKey });
    };
  }, [channelKey, queryClient]);

  const sendMut = useMutation({
    mutationFn: (body: string) =>
      api<ChatMessageView>("/api/chat", {
        method: "POST",
        body: { channelKey, body },
      }),
    onSuccess: (view) => {
      // Eigene Message direkt anhängen — WS-Echo macht idempotent dedup.
      queryClient.setQueryData<HistoryResponse>(queryKey, (prev) => {
        const list = prev?.messages ?? [];
        if (list.some((m) => m.id === view.id)) return prev;
        return { messages: [...list, view] };
      });
    },
  });

  // Pagination: ältere Nachrichten via ?before=<ältester createdAt> nachladen
  // und VORNE anhängen. `reachedStart` merkt sich, wenn der Server weniger als
  // eine volle Seite lieferte → Button ausblenden.
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);

  const loadOlder = useCallback(async () => {
    if (!channelKey || loadingOlder || reachedStart) return;
    const current = queryClient.getQueryData<HistoryResponse>(["chat", channelKey])?.messages ?? [];
    const oldest = current[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const res = await api<HistoryResponse>(
        `/api/chat?channelKey=${encodeURIComponent(channelKey)}&limit=50&before=${encodeURIComponent(
          oldest.createdAt
        )}`
      );
      if (res.messages.length < 50) setReachedStart(true);
      if (res.messages.length > 0) {
        queryClient.setQueryData<HistoryResponse>(["chat", channelKey], (prev) => {
          const list = prev?.messages ?? [];
          const seen = new Set(list.map((m) => m.id));
          const fresh = res.messages.filter((m) => !seen.has(m.id));
          return { messages: [...fresh, ...list] };
        });
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [channelKey, loadingOlder, reachedStart, queryClient]);

  const messages = data?.messages ?? [];
  return {
    messages,
    isLoading: isPending && channelKey !== null,
    error,
    sendMessage: async (body: string) => {
      await sendMut.mutateAsync(body);
    },
    isSending: sendMut.isPending,
    sendError: sendMut.error,
    loadOlder,
    isLoadingOlder: loadingOlder,
    // Button nur zeigen, wenn die erste Seite voll war (= es gibt vermutlich
    // mehr) und wir noch nicht am Anfang angekommen sind.
    canLoadOlder: !reachedStart && messages.length >= 50,
  };
}
