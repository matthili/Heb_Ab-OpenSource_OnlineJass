/**
 * Profil-Konversations-History.
 *
 * Zwei-Spalten-Layout: links die DM-Partner-Liste (sortiert nach letztem
 * Kontakt), rechts der Verlauf zur ausgewählten Person mit Filter
 * „Alle / Spielnachrichten / Lobby-Nachrichten" und inline-Markierung
 * „Während Partie #X, Mitspieler: …" bei DMs aus einem aktiven Spiel.
 *
 * Daten:
 *   - GET /api/chat/conversations                  → Partner-Liste
 *   - GET /api/chat/conversations/:otherUserId?filter=… → Verlauf + game-Contexts
 *
 * Bewusst kein Live-Push: das Profil ist ein retro-Bereich, kein Live-Chat.
 * Bei Bedarf einfach neu laden. Die aktive Lobby-Chat-Komponente bleibt
 * separat (`ChatPanel`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import DOMPurify from "dompurify";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { makeDmChannelKey } from "~/features/chat/dm";
import { EmojiPicker } from "~/features/chat/EmojiPicker";
import { UserName } from "~/features/social/UserName";
import { api } from "~/lib/api";
import { useSession } from "~/lib/auth-client";

// Defense-in-Depth wie in ChatBubble.tsx: der Server liefert bereits
// sanitized HTML (chat.sanitize.ts), wir sanitizen vor dem Rendern trotzdem
// nochmal client-seitig (Plan-Doc-Sicherheits-Checkliste #6, Sicherheitsaudit
// 2026-06-30 — diese Stelle hatte das double-sanitize bislang nicht).
const ALLOWED_TAGS = ["p", "strong", "em", "code", "a", "br"];
const ALLOWED_ATTR = ["href", "title", "target", "rel"];

interface Partner {
  partner: { id: string; name: string };
  lastMessage: { body: string; createdAt: string; wasDuringGame: boolean };
}
interface Message {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  gameId: string | null;
}
interface ConversationView {
  messages: Message[];
  gameContexts: Record<string, { mitspieler: string[] }>;
}

type Filter = "all" | "during-game" | "no-game";

export function ConversationsPanel() {
  const { t } = useTranslation();
  const partners = useQuery<{ partners: Partner[] }>({
    queryKey: ["chat", "conversations"],
    queryFn: () => api("/api/chat/conversations"),
    staleTime: 15_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (partners.isPending) {
    return <p className="text-stone-500 text-sm">{t("profile.conversations.loading")}</p>;
  }
  if (partners.isError || !partners.data) {
    return <p className="text-rose-700 text-sm">{t("profile.conversations.loadError")}</p>;
  }
  if (partners.data.partners.length === 0) {
    return (
      <section className="rounded border border-stone-200 p-3 text-sm text-stone-600">
        {t("profile.conversations.empty")}
      </section>
    );
  }

  return (
    <section className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4">
      <PartnerList
        partners={partners.data.partners}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selectedId === null ? (
        <p className="text-sm text-stone-500 italic">{t("profile.conversations.selectHint")}</p>
      ) : (
        <ConversationView partnerId={selectedId} />
      )}
    </section>
  );
}

function PartnerList({
  partners,
  selectedId,
  onSelect,
}: {
  partners: Partner[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="border border-stone-200 rounded divide-y divide-stone-100 max-h-[28rem] overflow-y-auto">
      {partners.map((p) => {
        const active = p.partner.id === selectedId;
        return (
          <li key={p.partner.id}>
            <button
              type="button"
              onClick={() => onSelect(p.partner.id)}
              className={
                "block w-full text-left px-3 py-2 hover:bg-stone-50 " +
                (active ? "bg-stone-100" : "")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{p.partner.name}</span>
                <span className="text-xs text-stone-500 shrink-0">
                  {formatRelative(p.lastMessage.createdAt, t)}
                </span>
              </div>
              <div className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                {p.lastMessage.wasDuringGame && (
                  <span
                    title={t("profile.conversations.fromGame")}
                    aria-label={t("profile.conversations.fromGame")}
                  >
                    🎲
                  </span>
                )}
                <span
                  className="truncate"
                  // body ist server-seitig sanitized; trotzdem nur text-only
                  // hier (kein dangerouslySetInnerHTML) — Vorschau soll nicht
                  // HTML-formatieren.
                >
                  {stripHtml(p.lastMessage.body)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ConversationView({ partnerId }: { partnerId: string }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const conv = useQuery<ConversationView>({
    queryKey: ["chat", "conversations", partnerId, filter],
    queryFn: () => api(`/api/chat/conversations/${partnerId}?filter=${filter}`),
    staleTime: 10_000,
  });

  const { data: session } = useSession();
  const myId = session?.user?.id;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const send = useMutation({
    mutationFn: (body: string) =>
      api("/api/chat", {
        method: "POST",
        body: { channelKey: makeDmChannelKey(myId!, partnerId), body },
      }),
    onSuccess: () => {
      setDraft("");
      // Verlauf (alle Filter) + Partnerliste neu laden — Prefix-Invalidate.
      void queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="conv-filter" className="text-stone-600">
          {t("profile.conversations.filterLabel")}
        </label>
        <select
          id="conv-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="rounded border border-stone-300 px-2 py-1"
        >
          <option value="all">{t("profile.conversations.filterAll")}</option>
          <option value="during-game">{t("profile.conversations.filterDuringGame")}</option>
          <option value="no-game">{t("profile.conversations.filterNoGame")}</option>
        </select>
        <BlockControl partnerId={partnerId} />
      </div>

      {conv.isPending && (
        <p className="text-sm text-stone-500">{t("profile.conversations.loadingHistory")}</p>
      )}
      {conv.data && conv.data.messages.length === 0 && (
        <p className="text-sm text-stone-500 italic">
          {t("profile.conversations.noMessagesForFilter")}
        </p>
      )}
      {conv.data && conv.data.messages.length > 0 && <MessageList view={conv.data} />}

      {myId && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const body = draft.trim();
            if (body) send.mutate(body);
          }}
          className="flex items-center gap-2"
        >
          <EmojiPicker onPick={(e) => setDraft((d) => d + e)} />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("profile.conversations.replyPlaceholder")}
            maxLength={2000}
            className="flex-1 rounded border border-stone-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={send.isPending || draft.trim().length === 0}
            className="btn-jass-primary text-sm disabled:opacity-50"
          >
            {t("profile.conversations.send")}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * „PN-Erlaubnis entziehen" pro Partner. Legt serverseitig einen `DmBlock` an
 * (overruled die dmPolicy-Einstellung) bzw. hebt ihn wieder auf. Der Block
 * verhindert, dass dieser Partner dir Privatnachrichten schickt.
 */
function BlockControl({ partnerId }: { partnerId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const blocks = useQuery<{ blockedUserIds: string[] }>({
    queryKey: ["chat", "dm-blocks"],
    queryFn: () => api("/api/chat/dm-blocks"),
    staleTime: 30_000,
  });
  const blocked = blocks.data?.blockedUserIds.includes(partnerId) ?? false;

  const toggle = useMutation({
    mutationFn: () =>
      api(`/api/chat/dm-blocks/${partnerId}`, { method: blocked ? "DELETE" : "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat", "dm-blocks"] }),
  });

  if (blocks.isPending) return null;

  return (
    <div className="ml-auto flex items-center gap-2">
      {blocked && (
        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700">
          {t("profile.conversations.blockedBadge")}
        </span>
      )}
      <button
        type="button"
        onClick={() => toggle.mutate()}
        disabled={toggle.isPending}
        className={
          "text-xs underline decoration-dotted hover:decoration-solid disabled:opacity-50 " +
          (blocked ? "text-emerald-700" : "text-rose-700")
        }
      >
        {blocked ? t("profile.conversations.unblockDm") : t("profile.conversations.blockDm")}
      </button>
    </div>
  );
}

function MessageList({ view }: { view: ConversationView }) {
  // Wir gruppieren aufeinanderfolgende Nachrichten mit derselben `gameId` in
  // einen Block. Wechselt die `gameId`, kommt ein neuer Kontext-Header dazu —
  // das ergibt die Spec-Markierung „Während Partie #X, Mitspieler: …".
  const blocks: Array<{ gameId: string | null; messages: Message[] }> = [];
  for (const m of view.messages) {
    const last = blocks[blocks.length - 1];
    if (last && last.gameId === m.gameId) {
      last.messages.push(m);
    } else {
      blocks.push({ gameId: m.gameId, messages: [m] });
    }
  }

  return (
    <ol className="space-y-3 max-h-[28rem] overflow-y-auto">
      {blocks.map((b, idx) => (
        <li key={idx} className="space-y-2">
          {b.gameId !== null && (
            <GameContextHeader
              gameId={b.gameId}
              mitspieler={view.gameContexts[b.gameId]?.mitspieler ?? []}
            />
          )}
          <ul className="space-y-1">
            {b.messages.map((m) => (
              <li key={m.id} className="text-sm">
                <UserName userId={m.senderId} name={m.senderName} className="font-medium" />
                <span className="text-xs text-stone-500 ml-2">
                  {new Date(m.createdAt).toLocaleString()}
                </span>
                {/*
                 * Body kommt sanitized vom Server (DOMPurify, allowlist).
                 * Wir rendern als HTML, damit Markdown-Formatierung (z.B.
                 * **fett**) sichtbar ist — und sanitizen zusätzlich hier
                 * nochmal client-seitig (siehe Kommentar bei den Imports).
                 */}
                <div
                  className="prose prose-sm max-w-none text-stone-800"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(m.body, {
                      ALLOWED_TAGS,
                      ALLOWED_ATTR,
                      KEEP_CONTENT: true,
                    }),
                  }}
                />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function GameContextHeader({ gameId, mitspieler }: { gameId: string; mitspieler: string[] }) {
  const { t } = useTranslation();
  const shortId = gameId.slice(-6); // CUID-Tail als Lesehilfe
  return (
    <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-900 flex items-center flex-wrap gap-1">
      <span aria-hidden="true">🎲</span>
      <span>
        <Trans
          i18nKey="profile.conversations.duringGame"
          values={{ shortId }}
          components={{ code: <code className="font-mono" /> }}
        />
      </span>
      {mitspieler.length > 0 && (
        <span>
          <Trans
            i18nKey="profile.conversations.withPlayers"
            values={{ players: mitspieler.join(", ") }}
            components={{ name: <span className="font-medium" /> }}
          />
        </span>
      )}
      <Link
        to="/replay/$gameId"
        params={{ gameId }}
        className="ml-auto underline decoration-dotted hover:decoration-solid"
      >
        {t("profile.conversations.openReplay")}
      </Link>
    </div>
  );
}

function stripHtml(html: string): string {
  // Klein-Helper für die Partner-Liste-Vorschau: nur sichtbaren Text behalten.
  return html.replace(/<[^>]+>/g, "").trim();
}

function formatRelative(iso: string, t: TFunction): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return t("profile.conversations.relativeJustNow");
  if (min < 60) return t("profile.conversations.relativeMinutes", { count: min });
  const h = Math.round(min / 60);
  if (h < 24) return t("profile.conversations.relativeHours", { count: h });
  const days = Math.round(h / 24);
  if (days < 14) return t("profile.conversations.relativeDays", { count: days });
  return d.toLocaleDateString();
}
