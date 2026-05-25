/**
 * Profil-Seite des eingeloggten Users.
 *
 * Tabs (M10):
 *   - Spiel-History (M10-B): Liste eigener Partien mit Kontext + Replay-Link
 *   - Meine Daten (M10-C/M10-D): Datenexport, Account löschen
 *
 * Die DSGVO-relevanten Aktionen leben absichtlich in einem eigenen Tab —
 * das macht es einfacher, „mein Spiel-Verlauf" konsumierbar zu halten und
 * trotzdem den „Sensitive-Settings"-Bereich klar abzugrenzen.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { GameHistoryList } from "~/features/replay/GameHistoryList";
import { FriendsPanel } from "~/features/profile/FriendsPanel";
import { ProfileDataPanel } from "~/features/profile/ProfileDataPanel";
import { ProfileEditPanel } from "~/features/profile/ProfileEditPanel";
import { SessionsPanel } from "~/features/profile/SessionsPanel";
import { UserStatsPanel } from "~/features/profile/UserStatsPanel";

type ProfileTab = "history" | "edit" | "friends" | "sessions" | "data";
interface ProfileSearch {
  tab?: ProfileTab;
}

const VALID_TABS: readonly ProfileTab[] = ["history", "edit", "friends", "sessions", "data"];

export const Route = createFileRoute("/_auth/profile")({
  validateSearch: (search: Record<string, unknown>): ProfileSearch => {
    const raw = search["tab"];
    const tab = VALID_TABS.find((t) => t === raw);
    return tab ? { tab } : { tab: "history" };
  },
  component: ProfilePage,
});

function ProfilePage() {
  const { t } = useTranslation();
  const { tab } = useSearch({ from: "/_auth/profile" });
  const activeTab: ProfileTab = tab ?? "history";

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
      <nav className="border-b border-stone-200 flex gap-2 text-sm" aria-label="Profil-Bereiche">
        <TabLink target="history" active={activeTab === "history"}>
          {t("profile.tabs.history")}
        </TabLink>
        <TabLink target="edit" active={activeTab === "edit"}>
          {t("profile.tabs.edit")}
        </TabLink>
        <TabLink target="friends" active={activeTab === "friends"}>
          {t("profile.tabs.friends")}
        </TabLink>
        <TabLink target="sessions" active={activeTab === "sessions"}>
          {t("profile.tabs.sessions")}
        </TabLink>
        <TabLink target="data" active={activeTab === "data"}>
          {t("profile.tabs.data")}
        </TabLink>
      </nav>
      {activeTab === "history" && (
        <>
          <UserStatsPanel />
          <h2 className="text-lg font-semibold pt-2">{t("profile.history.title")}</h2>
          <GameHistoryList />
        </>
      )}
      {activeTab === "edit" && <ProfileEditPanel />}
      {activeTab === "friends" && <FriendsPanel />}
      {activeTab === "sessions" && <SessionsPanel />}
      {activeTab === "data" && <ProfileDataPanel />}
    </section>
  );
}

function TabLink({
  target,
  active,
  children,
}: {
  target: ProfileTab;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/profile"
      search={{ tab: target }}
      className={
        "px-3 py-2 -mb-px border-b-2 " +
        (active
          ? "border-stone-900 text-stone-900 font-medium"
          : "border-transparent text-stone-600 hover:text-stone-900")
      }
    >
      {children}
    </Link>
  );
}
