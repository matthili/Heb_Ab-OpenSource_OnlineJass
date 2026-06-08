/**
 * **DealCinematic** — ersetzt das einfache CutDeckIntro durch eine
 * mehrphasige Animation, die das traditionelle Geber/Abheben/Verteilen
 * abbildet.
 *
 * Phasen-Ablauf:
 *   1. `mix`      (1.0 s) — Geber-Sitz hervorgehoben, kleiner Misch-Wackel
 *   2. `slide`    (0.6 s) — Stapel gleitet vom Geber zum Abheber
 *   3. `wait-cut` (≤10 s) — Wartet auf Klick des Abhebers (Ansagers)
 *                          ODER Auto-Cut nach 10 s
 *   4. `cut`      (0.8 s) — Cut-Animation (Top-Half hebt, dreht, fällt)
 *   5. `deal`     (1.6 s) — 36 Karten als 4 × 9-Schwarm zu allen Sitzen
 *   6. `weli`     (1.2 s) — WELI-Reveal am Ansager-Sitz (groß + golden)
 *   7. `done`     — onComplete, Komponente unmounted
 *
 * **Geber-Berechnung**: GEBER = (ANSAGER - 1 + numPlayers) % numPlayers.
 * Der Ansager (= WELI-Inhaber bei Spiel 1) ist gleichzeitig der Abheber.
 *
 * **Lifecycle pro gameId**: localStorage merkt, welche gameIds bereits
 * die Cinematic gesehen haben — bei Reload wird nicht alles neu gespielt.
 *
 * **prefers-reduced-motion**: Cinematic wird sofort übersprungen.
 *
 * **Multi-User-Hinweis**: Aktuell läuft die Animation rein client-seitig.
 * Bei echten Mitspielern können die Phasen leicht versetzt sein. Für die
 * Solo-vs-3-KI-Demo absolut ausreichend; ein backend-getriggerter Sync
 * kommt in einer späteren Iteration.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { relativeSlot, type ScreenSlot } from "./seat-layout";

const SEEN_KEY = "jass:deal-cinematic-seen";
const CUT_TIMEOUT_MS = 10_000;

// Phasen-Timings (ms)
const T_MIX = 1000;
const T_SLIDE = 600;
const T_CUT = 800;
const T_DEAL = 1600;
const T_WELI = 1200;

type Phase = "mix" | "slide" | "wait-cut" | "cut" | "deal" | "weli" | "done";

interface Props {
  gameId: string;
  /** Sitz, von dessen Perspektive wir rendern (= eigener Sitz). */
  mySeat: number;
  /** Sitz des Ansagers — bestimmt Geber und Abheber. */
  announcerSeat: number;
  /** Spielerzahl, default 4. */
  numPlayers?: number;
  /**
   * `full` (Default) — volle Cinematic mit Misch + Slide + Wait-Cut + Cut.
   * `short` — direkt mit der Verteil-Animation starten (für Spiele 2+
   *   einer Partie, damit man nicht jedes Mal warten muss).
   */
  mode?: "full" | "short";
  /** Wird aufgerufen, wenn die Cinematic durch ist (oder übersprungen wird). */
  onComplete: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function markSeen(gameId: string): void {
  if (typeof window === "undefined") return;
  try {
    const seen = loadSeen();
    if (seen.has(gameId)) return;
    seen.add(gameId);
    // Rolling-Buffer max 50 — sonst wächst localStorage unkontrolliert.
    const arr = Array.from(seen).slice(-50);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {
    /* localStorage gesperrt → no-op */
  }
}

// Pixel-Offsets relativer Slot → Mittelpunkt-Verschiebung der Animation.
// Werte heuristisch passend zum Spielfeld-Layout (h-clamp(32rem,...)).
const SLOT_OFFSETS: Record<ScreenSlot, { x: number; y: number }> = {
  bottom: { x: 0, y: 180 },
  top: { x: 0, y: -180 },
  left: { x: -260, y: 0 },
  right: { x: 260, y: 0 },
};

export function DealCinematic({
  gameId,
  mySeat,
  announcerSeat,
  numPlayers = 4,
  mode = "full",
  onComplete,
}: Props) {
  // Geber = vor dem Ansager im UZS = (announcer - 1 + n) % n
  const dealerSeat = (((announcerSeat - 1) % numPlayers) + numPlayers) % numPlayers;
  const cutterSeat = announcerSeat;
  const iAmCutter = mySeat === cutterSeat;

  const dealerSlot = relativeSlot(dealerSeat, mySeat);
  const cutterSlot = relativeSlot(cutterSeat, mySeat);
  const dealerOff = SLOT_OFFSETS[dealerSlot];
  const cutterOff = SLOT_OFFSETS[cutterSlot];

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Skip-Logik:
  //   - prefers-reduced-motion → sofort done
  //   - schon gesehen → sofort done
  const skip = useMemo(() => {
    if (prefersReducedMotion()) return true;
    return loadSeen().has(gameId);
  }, [gameId]);

  // Im short-Mode beginnen wir direkt mit der Verteil-Phase — der
  // Geber/Abheben-Teil wird übersprungen (passiert beim echten Tisch
  // ja auch nicht jedes Mal mit voller Zeremonie).
  const [phase, setPhase] = useState<Phase>(skip ? "done" : mode === "short" ? "deal" : "mix");

  // Sobald done → markSeen + onComplete.
  useEffect(() => {
    if (phase !== "done") return;
    markSeen(gameId);
    // Microtask, damit der Parent erst nach dem Render unmounted.
    const t = setTimeout(() => onCompleteRef.current(), 0);
    return () => clearTimeout(t);
  }, [phase, gameId]);

  // Phasen-Sequenz via Timeouts (außer wait-cut, der manuell endet).
  useEffect(() => {
    if (skip) return;
    let timeouts: ReturnType<typeof setTimeout>[] = [];
    const next = (p: Phase, after: number) => timeouts.push(setTimeout(() => setPhase(p), after));

    if (phase === "mix") next("slide", T_MIX);
    // Das ECHTE Abheben passiert jetzt in einer eigenen Phase VOR dieser
    // Cinematic (CutPhase im GameBoard). Die alte kosmetische Cut-Geste
    // (wait-cut/cut) wäre danach redundant → wir gehen direkt slide → deal.
    // (wait-cut/cut bleiben als Phasen definiert, werden aber nicht mehr
    // angesteuert.)
    else if (phase === "slide") next("deal", T_SLIDE);
    else if (phase === "wait-cut") {
      // Auto-Cut nach 10 s, falls niemand klickt. (Nicht mehr erreicht.)
      next("cut", CUT_TIMEOUT_MS);
    } else if (phase === "cut") next("deal", T_CUT);
    // Die WELI-Reveal-Phase gehört NUR zum Match-Start (full): da ist der
    // Ansager der WELI-Inhaber. Innerhalb eines Matches (short, Spiel 2+)
    // rotiert der Ansager im Uhrzeigersinn — er hält das WELI i.d.R. NICHT,
    // also überspringen wir die Phase (sonst „WELI mitten im Match").
    else if (phase === "deal") next(mode === "short" ? "done" : "weli", T_DEAL);
    else if (phase === "weli") next("done", T_WELI);

    return () => {
      timeouts.forEach(clearTimeout);
      timeouts = [];
    };
  }, [phase, skip]);

  const onCutClick = useCallback(() => {
    if (phase === "wait-cut") setPhase("cut");
  }, [phase]);

  if (phase === "done") return null;

  // ─── Phasen-spezifisches Rendering ─────────────────────────────────
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center overflow-visible"
    >
      {/* Banner: Wer gibt aus? Wer hebt ab? */}
      <DealBanner phase={phase} iAmCutter={iAmCutter} />

      {/* Stapel — sichtbar in den Phasen mix..cut. Position wechselt je nach Phase. */}
      {(phase === "mix" || phase === "slide" || phase === "wait-cut" || phase === "cut") && (
        <Stack
          phase={phase}
          dealerOff={dealerOff}
          cutterOff={cutterOff}
          iAmCutter={iAmCutter}
          onCutClick={onCutClick}
        />
      )}

      {/* Verteilen — fliegende Karten zu allen 4 Sitzen */}
      {phase === "deal" && (
        <DealSwarm mySeat={mySeat} cutterOff={cutterOff} numPlayers={numPlayers} />
      )}

      {/* WELI-Reveal am Ansager-Sitz */}
      {phase === "weli" && <WeliReveal cutterOff={cutterOff} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-Komponenten
// ─────────────────────────────────────────────────────────────────────

function DealBanner({ phase, iAmCutter }: { phase: Phase; iAmCutter: boolean }) {
  const { t } = useTranslation();
  let text: string | null = null;
  if (phase === "mix") text = t("game.deal.mixing");
  else if (phase === "slide") text = t("game.deal.sliding");
  else if (phase === "wait-cut")
    text = iAmCutter ? t("game.deal.cutNow") : t("game.deal.waitingCut");
  else if (phase === "cut") text = t("game.deal.cutDone");
  else if (phase === "deal") text = t("game.deal.dealing");
  else if (phase === "weli") text = t("game.deal.weli");
  if (!text) return null;
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-jass-ink/80 text-jass-cream px-4 py-1.5 text-sm font-semibold shadow-lg backdrop-blur">
      {text}
    </div>
  );
}

function Stack({
  phase,
  dealerOff,
  cutterOff,
  iAmCutter,
  onCutClick,
}: {
  phase: Phase;
  dealerOff: { x: number; y: number };
  cutterOff: { x: number; y: number };
  iAmCutter: boolean;
  onCutClick: () => void;
}) {
  // Position je Phase
  let from: { x: number; y: number };
  let to: { x: number; y: number };
  if (phase === "mix") {
    from = dealerOff;
    to = dealerOff;
  } else if (phase === "slide") {
    from = dealerOff;
    to = cutterOff;
  } else {
    // wait-cut, cut
    from = cutterOff;
    to = cutterOff;
  }

  const wrapperStyle: React.CSSProperties = {
    transform: `translate(${to.x}px, ${to.y}px)`,
    transition: phase === "slide" ? "transform 0.6s cubic-bezier(0.25,0.46,0.45,0.94)" : "none",
  };
  // Bei mix: setze auch from als initial — dafür „initialer transform" via key.
  const cssVars = {
    ["--from-x" as never]: `${from.x}px`,
    ["--from-y" as never]: `${from.y}px`,
    ["--to-x" as never]: `${to.x}px`,
    ["--to-y" as never]: `${to.y}px`,
  } as React.CSSProperties;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="absolute" style={{ ...wrapperStyle, ...cssVars }}>
        {phase === "cut" ? (
          // Cut-Animation: 2 Halbstapel die sich kreuzen
          <CutAnimation />
        ) : (
          <StackVisual
            wobble={phase === "mix"}
            pulse={phase === "wait-cut" && iAmCutter}
            {...(iAmCutter ? { onClick: onCutClick } : {})}
          />
        )}
      </div>
    </div>
  );
}

function StackVisual({
  wobble,
  pulse,
  onClick,
}: {
  wobble: boolean;
  pulse: boolean;
  onClick?: () => void;
}) {
  const wobbleCls = wobble ? "jass-deal-mix-wobble" : "";
  const pulseCls = pulse ? "jass-deal-cut-pulse" : "";
  // Stapel = 3 versetzte Karten-Rechtecke
  return (
    <div
      onClick={onClick}
      className={`relative ${wobbleCls} ${onClick ? "pointer-events-auto cursor-pointer" : ""}`}
      style={{ width: "5rem", height: "7rem" }}
    >
      <div
        className={`absolute inset-0 rounded ${pulseCls}`}
        style={{
          background:
            "linear-gradient(135deg, #c4302b 0%, #8a1f1c 100%), repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.05) 6px 8px)",
          backgroundBlendMode: "overlay",
          border: "2px solid #f5e6c8",
          boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
          transform: "translate(-3px, -3px)",
        }}
      />
      <div
        className="absolute inset-0 rounded"
        style={{
          background: "linear-gradient(135deg, #c4302b 0%, #8a1f1c 100%)",
          border: "2px solid #f5e6c8",
          boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        }}
      />
      <div
        className="absolute inset-0 rounded"
        style={{
          background: "linear-gradient(135deg, #c4302b 0%, #8a1f1c 100%)",
          border: "2px solid #f5e6c8",
          boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
          transform: "translate(3px, 3px)",
        }}
      />
    </div>
  );
}

function CutAnimation() {
  return (
    <div className="relative" style={{ width: "5rem", height: "7rem" }}>
      <div className="jass-cut-stack">
        <div className="jass-cut-top" />
        <div className="jass-cut-bottom" />
      </div>
    </div>
  );
}

function DealSwarm({
  mySeat,
  cutterOff,
  numPlayers,
}: {
  mySeat: number;
  cutterOff: { x: number; y: number };
  numPlayers: number;
}) {
  // 9 Karten pro Sitz × num_players Sitze = 36 Stellvertreter-Karten.
  // Wir geben jedem Ziel-Sitz einen kleinen Stapel mit Pos-Jitter.
  const cards = useMemo(() => {
    const out: Array<{
      key: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
      delay: number;
      rot: number;
    }> = [];
    for (let s = 0; s < numPlayers; s++) {
      const slot = relativeSlot(s, mySeat);
      const off = SLOT_OFFSETS[slot];
      for (let i = 0; i < 9; i++) {
        out.push({
          key: `${s}-${i}`,
          from: cutterOff,
          to: {
            x: off.x + ((i % 3) - 1) * 4,
            y: off.y + (Math.floor(i / 3) - 1) * 4,
          },
          // Gestaffelt: jede Karte ~25ms später, dadurch wirkt's wie
          // ein Schwarm der reihum zu jedem Sitz fliegt.
          delay: s * 60 + i * 25,
          rot: (Math.random() - 0.5) * 8,
        });
      }
    }
    return out;
  }, [mySeat, cutterOff, numPlayers]);

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {cards.map((c) => (
        <div
          key={c.key}
          className="jass-deal-fly absolute rounded"
          style={
            {
              width: "2.5rem",
              height: "3.5rem",
              background: "linear-gradient(135deg, #c4302b 0%, #8a1f1c 100%)",
              border: "1.5px solid #f5e6c8",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              ["--from-x" as never]: `${c.from.x}px`,
              ["--from-y" as never]: `${c.from.y}px`,
              ["--to-x" as never]: `${c.to.x}px`,
              ["--to-y" as never]: `${c.to.y}px`,
              ["--end-rot" as never]: `${c.rot}deg`,
              animationDelay: `${c.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function WeliReveal({ cutterOff }: { cutterOff: { x: number; y: number } }) {
  // Start: am Ansager-Stapel. Ende: leicht hinter dem Banner, vergrößert.
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <img
        src="/cards/schelle-6-weli.png"
        alt="WELI"
        draggable={false}
        className="jass-deal-weli-reveal absolute"
        style={
          {
            height: "8rem",
            width: "auto",
            ["--from-x" as never]: `${cutterOff.x}px`,
            ["--from-y" as never]: `${cutterOff.y}px`,
            ["--to-x" as never]: "0px",
            ["--to-y" as never]: "0px",
          } as React.CSSProperties
        }
      />
    </div>
  );
}
