/**
 * Dialog zum Öffnen eines neuen Tisches — **Redesign (Spiel-Pipeline)**.
 *
 * Im Vergleich zur ersten Version (Plain-Radios + Slider):
 *
 *   - **Tile-Selector** statt Radio-Listen: jede Option ist eine eigene
 *     anklickbare Kachel mit Titel + Kurztext. Stark selektiert (Border +
 *     Hintergrund) zeigt den aktuellen Zustand auf einen Blick.
 *   - **Sektionen** mit Filz-Hintergrund + Header gliedern den Dialog
 *     klar in „Wer darf rein", „Gegen wen spiele ich", „Wie lang gewinnen
 *     wir", „Re-Match-Modus".
 *   - **Auto-Fill** ist von Schiebe-Regler auf 4 diskrete Presets +
 *     „Aus" umgestellt — der Regler-Schritt von 5s war als UI immer
 *     verwirrend („was bedeutet 47s?").
 *   - **Solo-gegen-3-KI** ist jetzt ein Shortcut OBEN, der bei Klick
 *     den Modus auf „nur Einladung" stellt + AI-Sitze 1-3 belegt. Damit
 *     ist der häufigste Anfänger-Use-Case 1 Click.
 *   - **Live-Summary** unten fasst die Auswahl in einem Satz zusammen,
 *     bevor man bestätigt. Reduziert „Hab ich das richtig eingestellt?"-Fehler.
 *
 * Wir bleiben beim nativen `<dialog>`-Element (Esc + Backdrop-Klick = nativ a11y).
 * Radix-Dialog käme erst, wenn wir mehrere Modals stapeln müssten.
 *
 * **Sicherheit**: Identisch zur Vorgänger-Version. Der Dialog ist reine
 * Client-Eingabe-Hilfe; jede Option wird vom Backend nochmal validiert
 * (DTO via Zod). Wir können hier zero-trust mit dem Frontend-State umgehen.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { api, ApiError } from "~/lib/api";
import type { JoinMode, OpenTableDto, RestartMode } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
}

type AiSeatType = "random" | "heuristic" | "nn";

const JOIN_MODE_OPTIONS: ReadonlyArray<{
  value: JoinMode;
  title: string;
  hint: string;
}> = [
  { value: "OPEN", title: "Offen", hint: "Jeder darf reinkommen — Plätze füllen sich von allein." },
  { value: "REQUEST", title: "Auf Anfrage", hint: "Beitritte erst nach deiner Zustimmung." },
  { value: "INVITE", title: "Nur Einladung", hint: "Nur deine Freunde sehen den Tisch." },
];

const AI_TYPE_OPTIONS: ReadonlyArray<{
  value: AiSeatType;
  title: string;
  hint: string;
}> = [
  {
    value: "heuristic",
    title: "Heuristik",
    hint: "Schnelle, solide Standard-KI — der Default für die meisten Tische.",
  },
  {
    value: "nn",
    title: "Neuronales Netz",
    hint: "Stärkster Gegner; braucht den Inferenz-Microservice.",
  },
  {
    value: "random",
    title: "Zufall",
    hint: "Spielt nur legale Karten zufällig — zum Üben oder für Tests.",
  },
];

const RESTART_OPTIONS: ReadonlyArray<{
  value: RestartMode;
  title: string;
  hint: string;
}> = [
  {
    value: "SIEGER_GIBT",
    title: "Sieger gibt",
    hint: "Klassisch: wer das letzte Spiel gewonnen hat, gibt das nächste.",
  },
  {
    value: "WELI",
    title: "WELI ausspielen",
    hint: "Karten austeilen — wer das WELI hat, beginnt das nächste Spiel.",
  },
];

// Auto-Fill als diskrete Presets — exakte Werte, die auch der Slider
// sinnvoll abbilden konnte. „Aus" wird intern zu `null`.
const AUTO_FILL_PRESETS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: "Aus", value: null },
  { label: "15 s", value: 15 },
  { label: "30 s", value: 30 },
  { label: "1 min", value: 60 },
  { label: "2 min", value: 120 },
];

const SCORE_PRESETS: readonly number[] = [500, 1000, 1200, 2500];

export function OpenTableDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [joinMode, setJoinMode] = useState<JoinMode>("OPEN");
  const [aiSeatType, setAiSeatType] = useState<AiSeatType>("heuristic");
  const [autoFill, setAutoFill] = useState<number | null>(30);
  const [restartMode, setRestartMode] = useState<RestartMode>("SIEGER_GIBT");
  const [targetScore, setTargetScore] = useState<number>(1000);
  const [soloVsAi, setSoloVsAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingTableId, setExistingTableId] = useState<string | null>(null);

  // open/close ↔ <dialog> öffnen/schließen synchronisieren
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const openMut = useMutation({
    mutationFn: (dto: OpenTableDto) =>
      api<{ tableId: string }>("/api/lobby/tables", { method: "POST", body: dto }),
    onSuccess: ({ tableId }) => {
      queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
      onClose();
      void navigate({ to: "/table/$id", params: { id: tableId } });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setError(err.message);
        const body = err.body;
        if (
          body &&
          typeof body === "object" &&
          "existingTableId" in body &&
          typeof (body as { existingTableId?: unknown }).existingTableId === "string"
        ) {
          setExistingTableId((body as { existingTableId: string }).existingTableId);
        } else {
          setExistingTableId(null);
        }
      } else {
        setError("Tisch konnte nicht geöffnet werden.");
        setExistingTableId(null);
      }
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setExistingTableId(null);
    const dto: OpenTableDto = {
      joinMode,
      aiSeatType,
      autoFillSeconds: autoFill,
      restartMode,
      targetScore,
      initialAiSeats: soloVsAi ? [{ seat: 1 }, { seat: 2 }, { seat: 3 }] : [],
    };
    openMut.mutate(dto);
  }

  /**
   * 1-Click-Shortcut: für „nur ich gegen 3 KI". Setzt:
   *   - JoinMode auf INVITE (sonst stolpert noch jemand rein)
   *   - Auto-Fill an (30 s) — nur als Fallback, wird durch initialAiSeats
   *     ohnehin sofort erledigt
   *   - Solo-Modus
   */
  function applySoloPreset() {
    setJoinMode("INVITE");
    setAutoFill(30);
    setSoloVsAi(true);
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-lg p-0 backdrop:bg-stone-900/40 w-full max-w-xl"
    >
      <form onSubmit={submit} className="bg-jass-paper">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-jass-paperEdge">
          <div>
            <h2 className="text-xl font-bold text-jass-ink">Neuen Tisch öffnen</h2>
            <p className="text-xs text-jass-inkSoft mt-0.5">
              Lege Beitritts-Regeln, Gegner und Punkteziel fest.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="text-jass-inkSoft hover:text-jass-ink text-2xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="px-6 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Solo-Shortcut */}
          <button
            type="button"
            onClick={applySoloPreset}
            className={`w-full rounded-lg border-2 px-4 py-3 text-left transition ${
              soloVsAi
                ? "border-jass-yellowDark bg-jass-yellow/20"
                : "border-jass-paperEdge bg-jass-cream hover:bg-jass-yellow/10"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-jass-ink">
                  🎯 Direkt allein gegen 3 KI starten
                </div>
                <div className="text-xs text-jass-inkSoft mt-0.5">
                  Klick und los — Tisch ist privat, Sitze 1–3 werden mit der gewählten KI belegt.
                </div>
              </div>
              <input
                type="checkbox"
                checked={soloVsAi}
                readOnly
                tabIndex={-1}
                className="pointer-events-none h-4 w-4"
                aria-hidden="true"
              />
            </div>
          </button>

          {/* Wer darf rein */}
          <Section title="Wer darf an den Tisch?">
            <TileGrid>
              {JOIN_MODE_OPTIONS.map((opt) => (
                <Tile
                  key={opt.value}
                  selected={joinMode === opt.value}
                  onClick={() => setJoinMode(opt.value)}
                  title={opt.title}
                  hint={opt.hint}
                />
              ))}
            </TileGrid>
          </Section>

          {/* Gegner-Typ */}
          <Section title="Welche KI füllt freie Sitze?">
            <TileGrid>
              {AI_TYPE_OPTIONS.map((opt) => (
                <Tile
                  key={opt.value}
                  selected={aiSeatType === opt.value}
                  onClick={() => setAiSeatType(opt.value)}
                  title={opt.title}
                  hint={opt.hint}
                />
              ))}
            </TileGrid>
          </Section>

          {/* Auto-Fill */}
          <Section title="Auto-Fill leerer Sitze">
            <div className="flex flex-wrap gap-2">
              {AUTO_FILL_PRESETS.map((p) => (
                <Pill
                  key={p.label}
                  selected={autoFill === p.value}
                  onClick={() => setAutoFill(p.value)}
                  label={p.label}
                />
              ))}
            </div>
            <p className="text-xs text-jass-inkSoft mt-2">
              {autoFill === null
                ? "Sitze bleiben offen, bis Spieler beitreten."
                : `Nach ${autoFill}s ohne weiteren Beitritt werden offene Sitze automatisch von KI besetzt.`}
            </p>
          </Section>

          {/* Punkteziel */}
          <Section title="Punkteziel der Partie">
            <div className="flex flex-wrap items-center gap-2">
              {SCORE_PRESETS.map((preset) => (
                <Pill
                  key={preset}
                  selected={targetScore === preset}
                  onClick={() => setTargetScore(preset)}
                  label={String(preset)}
                />
              ))}
              <label className="flex items-center gap-1 text-sm text-jass-inkSoft">
                eigenes:
                <input
                  type="number"
                  min={500}
                  max={5000}
                  step={50}
                  value={targetScore}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setTargetScore(n);
                  }}
                  className="w-24 rounded border border-jass-paperEdge bg-jass-cream px-2 py-1 text-sm"
                  aria-label="Eigenes Punkteziel"
                />
              </label>
            </div>
            <p className="text-xs text-jass-inkSoft mt-2">
              Vorarlberger Standard: 1000 oder 1200. Erstes Team über dem Ziel gewinnt.
            </p>
          </Section>

          {/* Re-Match-Modus */}
          <Section title="Wer beginnt das nächste Spiel?">
            <TileGrid>
              {RESTART_OPTIONS.map((opt) => (
                <Tile
                  key={opt.value}
                  selected={restartMode === opt.value}
                  onClick={() => setRestartMode(opt.value)}
                  title={opt.title}
                  hint={opt.hint}
                />
              ))}
            </TileGrid>
          </Section>

          {/* Live-Zusammenfassung */}
          <SummaryRow
            joinMode={joinMode}
            aiSeatType={aiSeatType}
            autoFill={autoFill}
            restartMode={restartMode}
            targetScore={targetScore}
            soloVsAi={soloVsAi}
          />

          {error && (
            <div
              role="alert"
              className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 space-y-2"
            >
              <p>{error}</p>
              {existingTableId && (
                <p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      void navigate({ to: "/table/$id", params: { id: existingTableId } });
                    }}
                    className="underline font-medium hover:no-underline"
                  >
                    Zum bestehenden Tisch →
                  </button>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-6 py-4 border-t border-jass-paperEdge bg-jass-cream">
          <button type="button" onClick={onClose} className="btn-jass-secondary">
            Abbrechen
          </button>
          <button type="submit" disabled={openMut.isPending} className="btn-jass-primary">
            {openMut.isPending ? "Öffne …" : "Tisch öffnen"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-Komponenten
// ─────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-jass-ink mb-2">{title}</h3>
      {children}
    </section>
  );
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">{children}</div>;
}

function Tile({
  selected,
  onClick,
  title,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`text-left rounded-lg border-2 px-3 py-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-jass-yellowDark ${
        selected
          ? "border-jass-yellowDark bg-jass-yellow/25"
          : "border-jass-paperEdge bg-jass-cream hover:bg-jass-yellow/10"
      }`}
    >
      <div className="font-semibold text-jass-ink text-sm">{title}</div>
      <div className="text-xs text-jass-inkSoft mt-0.5 leading-snug">{hint}</div>
    </button>
  );
}

function Pill({
  selected,
  onClick,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full border px-3 py-1 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-jass-yellowDark ${
        selected
          ? "border-jass-yellowDark bg-jass-yellow text-jass-ink font-semibold"
          : "border-jass-paperEdge bg-jass-cream text-jass-inkSoft hover:bg-jass-yellow/10"
      }`}
    >
      {label}
    </button>
  );
}

function SummaryRow({
  joinMode,
  aiSeatType,
  autoFill,
  restartMode,
  targetScore,
  soloVsAi,
}: {
  joinMode: JoinMode;
  aiSeatType: AiSeatType;
  autoFill: number | null;
  restartMode: RestartMode;
  targetScore: number;
  soloVsAi: boolean;
}) {
  const joinLabel = JOIN_MODE_OPTIONS.find((o) => o.value === joinMode)?.title ?? joinMode;
  const aiLabel = AI_TYPE_OPTIONS.find((o) => o.value === aiSeatType)?.title ?? aiSeatType;
  const restartLabel = RESTART_OPTIONS.find((o) => o.value === restartMode)?.title ?? restartMode;
  return (
    <div className="rounded-lg bg-jass-cream border border-jass-paperEdge px-4 py-3 text-sm">
      <div className="text-xs font-semibold uppercase text-jass-inkSoft mb-1">Zusammenfassung</div>
      <div className="text-jass-ink leading-relaxed">
        {soloVsAi ? "Solo gegen 3 KI" : joinLabel} ·{" "}
        <span className="font-semibold">{aiLabel}</span> ·{" "}
        {autoFill === null ? "kein Auto-Fill" : `Auto-Fill nach ${autoFill}s`} · Ziel{" "}
        <span className="font-semibold">{targetScore}</span> · {restartLabel}
      </div>
    </div>
  );
}
