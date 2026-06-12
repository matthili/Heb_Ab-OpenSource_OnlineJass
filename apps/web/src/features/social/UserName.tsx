/**
 * Klickbarer Username — überall einsetzbar, wo ein Mitspieler-/User-Name steht.
 *
 * - **Einfachklick** → Kontextmenü (`UserContextMenu`: Privatnachricht, Profil,
 *   Freundschaft …).
 * - **Doppelklick** → öffnet direkt das DM-Fenster.
 * - Für **KI-Sitze** (keine `userId`) und den **eigenen** Namen wird nur Text
 *   gerendert (kein Menü, keine Interaktion).
 *
 * Einfach- vs. Doppelklick wird per kleinem Timer entkoppelt (sonst würde der
 * erste Klick eines Doppelklicks schon das Menü öffnen).
 */
import { useEffect, useRef, useState } from "react";

import { useDmWindows } from "~/lib/dm-windows";
import { useSession } from "~/lib/auth-client";
import { ReportDialog } from "./ReportDialog";
import { UserContextMenu } from "./UserContextMenu";

interface Props {
  /** User-ID; `null`/`undefined` (z.B. KI) → reiner Text. */
  userId: string | null | undefined;
  name: string;
  className?: string;
}

export function UserName({ userId, name, className = "" }: Props) {
  const { data: session } = useSession();
  const myId = session?.user?.id;
  const { open: openDm } = useDmWindows();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const clickTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clickTimer.current) window.clearTimeout(clickTimer.current);
    },
    []
  );

  // KI-Sitz (keine ID), eigener Name, oder nicht eingeloggt (öffentliche
  // Seiten) → nicht interaktiv. Social-Aktionen erfordern eine Session.
  if (!userId || !myId || userId === myId) {
    return <span className={className}>{name}</span>;
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Zweiter Klick eines Doppelklicks: Timer abbrechen, onDoubleClick übernimmt.
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      setMenuAt({ x: rect.left, y: rect.bottom + 2 });
    }, 220);
  };

  const handleDoubleClick = () => {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    openDm(userId, name);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={`cursor-pointer rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${className}`}
      >
        {name}
      </button>
      {menuAt && (
        <UserContextMenu
          userId={userId}
          name={name}
          anchor={menuAt}
          onClose={() => setMenuAt(null)}
          onReport={() => setReportOpen(true)}
        />
      )}
      <ReportDialog
        open={reportOpen}
        userId={userId}
        name={name}
        onClose={() => setReportOpen(false)}
      />
    </>
  );
}
