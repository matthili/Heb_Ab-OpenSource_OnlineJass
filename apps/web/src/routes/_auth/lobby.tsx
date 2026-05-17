/**
 * Lobby — Tisch-Übersicht mit Live-Updates und „Tisch öffnen"-Dialog.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LobbyList } from "~/features/lobby/LobbyList";
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
        <h1 className="text-2xl font-bold">{t("lobby.title")}</h1>
        <button
          type="button"
          onClick={() => setOpenDialog(true)}
          className="ml-auto rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700"
        >
          {t("lobby.openTable")}
        </button>
      </header>
      <LobbyList />
      <OpenTableDialog open={openDialog} onClose={() => setOpenDialog(false)} />
    </section>
  );
}
