/**
 * Lobby — Tisch-Übersicht mit Live-Updates und „Tisch öffnen"-Dialog.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ChatPanel } from "~/features/chat/ChatPanel";
import { LobbyList } from "~/features/lobby/LobbyList";
import { MyActiveTables } from "~/features/lobby/MyActiveTables";
import { OpenTableDialog } from "~/features/lobby/OpenTableDialog";

export const Route = createFileRoute("/_auth/lobby")({
  component: LobbyPage,
});

function LobbyPage() {
  const { t } = useTranslation();
  const [openDialog, setOpenDialog] = useState(false);
  return (
    <section className="space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-3xl text-jass-ink">{t("lobby.title")}</h1>
        <button
          type="button"
          onClick={() => setOpenDialog(true)}
          className="ml-auto btn-jass-primary"
        >
          {t("lobby.openTable")}
        </button>
      </header>
      <MyActiveTables />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4">
        <LobbyList />
        <ChatPanel channelKey="lobby:global" title={t("lobby.title")} />
      </div>
      <OpenTableDialog open={openDialog} onClose={() => setOpenDialog(false)} />
    </section>
  );
}
