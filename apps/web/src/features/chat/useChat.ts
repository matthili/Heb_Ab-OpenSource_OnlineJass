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
import { useEffect } from "react";

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
  useEffect(() => {
    if (!channelKey) return;
    const socket = getLobbySocket();
    socket.emit("chat:subscribe", { channelKey });

    function onMessage(view: ChatMessageView) {
      if (view.channelKey !== channelKey) return;
      queryClient.setQueryData<HistoryResponse>(queryKey, (prev) => {
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
  }, [channelKey, queryClient, queryKey]);

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

  return {
    messages: data?.messages ?? [],
    isLoading: isPending && channelKey !== null,
    error,
    sendMessage: async (body: string) => {
      await sendMut.mutateAsync(body);
    },
    isSending: sendMut.isPending,
    sendError: sendMut.error,
  };
}
