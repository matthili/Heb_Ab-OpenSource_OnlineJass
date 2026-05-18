/**
 * Lobby-Hinweis: „du hast noch keinen Vornamen / Nachnamen eingetragen,
 * willst du das nachholen?". Erscheint nur wenn BEIDE Felder leer sind
 * (sonst wäre der Hinweis aufdringlich, sobald jemand nur eines füllt).
 *
 * **Dismissal**: sessionStorage. Klickt der User „Später", verschwindet
 * der Banner für den Rest des Browser-Tabs. Beim nächsten Login (oder
 * neuen Tab) erscheint er wieder — das ist Absicht: leichter Anstupser,
 * kein hartes Tracking via cookie/persistedState.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "~/lib/api";

interface MeView {
  profile: {
    realFirstName: string | null;
    realLastName: string | null;
  };
}

const DISMISS_KEY = "jass:completeProfile:dismissed";

export function CompleteProfilePrompt() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  // Beim ersten Render: sessionStorage abfragen. (Wir können nicht direkt
  // im useState-Initializer auf `window` zugreifen, falls SSR — das
  // Hydrate-Mismatch wäre garstig. Pragmatischer Side-Effect.)
  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      // sessionStorage ggf. blockiert (Privacy-Modus) — egal, dann zeigen.
    }
  }, []);

  const { data } = useQuery<MeView>({
    queryKey: ["users", "me"],
    queryFn: () => api<MeView>("/api/users/me"),
    // Wir brauchen das Profil nicht oft — die Daten ändern sich nur,
    // wenn der User selber speichert.
    staleTime: 60_000,
  });

  if (dismissed || !data) return null;
  const hasAny = (data.profile.realFirstName ?? "") + (data.profile.realLastName ?? "");
  if (hasAny.length > 0) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  }

  return (
    <aside
      className="rounded-lg border border-jass-yellowDark bg-jass-cream px-4 py-3 flex flex-wrap items-center gap-3"
      role="status"
    >
      <div className="flex-1 min-w-[16rem]">
        <p className="font-semibold text-jass-ink">{t("profile.completePrompt.title")}</p>
        <p className="text-sm text-jass-inkSoft">{t("profile.completePrompt.body")}</p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="rounded border border-jass-paperEdge bg-jass-paper px-3 py-1.5 text-sm text-jass-inkSoft hover:bg-jass-cream"
        >
          {t("profile.completePrompt.dismiss")}
        </button>
        <Link
          to="/profile"
          search={{ tab: "edit" }}
          className="btn-jass-primary text-sm"
          onClick={dismiss}
        >
          {t("profile.completePrompt.cta")}
        </Link>
      </div>
    </aside>
  );
}
