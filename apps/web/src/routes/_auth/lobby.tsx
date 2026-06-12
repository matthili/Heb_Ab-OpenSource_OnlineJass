/**
 * Lobby — Tisch-Übersicht mit Live-Updates und „Tisch öffnen"-Dialog.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ChatPanel } from "~/features/chat/ChatPanel";
import { LobbyList } from "~/features/lobby/LobbyList";
import { MyActiveTables } from "~/features/lobby/MyActiveTables";
import { OnlineUsersPanel } from "~/features/lobby/OnlineUsersPanel";
import { OpenTableDialog } from "~/features/lobby/OpenTableDialog";
import { BrandLogo } from "~/features/brand/BrandLogo";
import { IncomingInvites } from "~/features/lobby/IncomingInvites";
import { CompleteProfilePrompt } from "~/features/profile/CompleteProfilePrompt";
import { BirthdayReminder } from "~/features/social/BirthdayReminder";

export const Route = createFileRoute("/_auth/lobby")({
  component: LobbyPage,
});

function LobbyPage() {
  const { t } = useTranslation();
  const [openDialog, setOpenDialog] = useState(false);
  return (
    <section className="relative">
      {/* Dezentes Marken-Watermark hinter dem Lobby-Inhalt (rein dekorativ,
          theme-aware via BrandLogo). */}
      <BrandLogo
        variant="gestapelt"
        decorative
        className="pointer-events-none absolute left-1/2 top-24 w-[48rem] max-w-[75%] -translate-x-1/2 select-none opacity-20"
      />
      <div className="relative z-10 space-y-4">
        <header className="flex items-center gap-3">
          <h1 className="text-3xl text-jass-ink">{t("lobby.title")}</h1>
          <button
            type="button"
            onClick={() => setOpenDialog(true)}
            className="ml-auto btn-jass-primary"
          >
            {t("lobby.openTableButton")}
          </button>
        </header>
        <CompleteProfilePrompt />
        <BirthdayReminder />
        <IncomingInvites />
        <MyActiveTables />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4">
          <LobbyList />
          <div className="space-y-4">
            <OnlineUsersPanel />
            <ChatPanel channelKey="lobby:global" title={t("lobby.title")} />
          </div>
        </div>
        <OpenTableDialog open={openDialog} onClose={() => setOpenDialog(false)} />
      </div>
    </section>
  );
}
