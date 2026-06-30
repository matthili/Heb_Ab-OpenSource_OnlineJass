/**
 * Abmelden-Split-Button: linke Hälfte meldet **dieses Gerät** ab, der
 * Chevron rechts öffnet ein kleines Menü mit **„Überall abmelden"**
 * (widerruft alle anderen Sessions + meldet dieses Gerät ab).
 *
 * Fehler (Better-Auth `{ error }` oder Exception) werden als Toast gezeigt,
 * statt still nichts zu tun. Klick außerhalb / Escape schließt das Menü.
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { authClient, signOut } from "~/lib/auth-client";
import { useToast } from "~/lib/toast";

type AuthResult = { error?: unknown } | undefined;

export function SignOutMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Klick außerhalb + Escape schließen das Menü.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fail = (): void => showToast(t("nav.signOutFailed"), { variant: "error" });

  const thisDevice = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = (await signOut()) as AuthResult;
      if (res?.error) {
        fail();
        return;
      }
      await navigate({ to: "/" });
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  };

  const everywhere = async (): Promise<void> => {
    setOpen(false);
    setBusy(true);
    try {
      // Erst alle ANDEREN Geräte abmelden, dann dieses → effektiv überall.
      const other = (await authClient.revokeOtherSessions()) as AuthResult;
      if (other?.error) {
        fail();
        return;
      }
      const res = (await signOut()) as AuthResult;
      if (res?.error) {
        fail();
        return;
      }
      await navigate({ to: "/" });
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <div className="inline-flex items-stretch">
        <button
          type="button"
          onClick={thisDevice}
          disabled={busy}
          className="btn-jass-primary rounded-r-none text-sm disabled:opacity-50"
        >
          {t("nav.signOut")}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("nav.signOutMore")}
          className="btn-jass-primary -ml-px rounded-l-none px-2 text-sm disabled:opacity-50"
        >
          <span aria-hidden="true">▾</span>
        </button>
      </div>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-jass-paperEdge bg-jass-paper shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={everywhere}
            disabled={busy}
            className="block w-full whitespace-nowrap px-3 py-2 text-left text-sm text-jass-ink hover:bg-jass-cream disabled:opacity-50"
          >
            {t("nav.signOutEverywhere")}
          </button>
        </div>
      )}
    </div>
  );
}
