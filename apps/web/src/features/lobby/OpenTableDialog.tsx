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
import type { TFunction } from "i18next";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ANNOUNCE_LEVELS, type AnnounceLevel } from "@jass/engine";
import { api, ApiError } from "~/lib/api";
import type { JoinMode, OpenTableDto, RestartMode, TableVariant, WinMode } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
}

type AiSeatType = "random" | "heuristic" | "nn";

const JOIN_MODE_OPTIONS: readonly JoinMode[] = ["OPEN", "REQUEST", "INVITE"];

const AI_TYPE_OPTIONS: readonly AiSeatType[] = ["heuristic", "nn", "random"];

const RESTART_OPTIONS: readonly RestartMode[] = ["SIEGER_GIBT", "WELI"];

// Auto-Fill als diskrete Presets — exakte Werte, die auch der Slider
// sinnvoll abbilden konnte. „Aus" wird intern zu `null`. Der `label` ist nur
// ein stabiler React-Key; die sichtbare Beschriftung kommt aus i18n.
const AUTO_FILL_PRESETS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: "off", value: null },
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "1min", value: 60 },
  { label: "2min", value: 120 },
];

const SCORE_PRESETS: readonly number[] = [500, 1000, 1200, 2500];

// Default-Punkteziel pro Spielart (Vorarlberger Konvention).
const DEFAULT_SCORE: Record<TableVariant, number> = {
  KREUZ_4P: 1000,
  SOLO_4P: 500,
  BODENSEE_2P: 500,
};

const VARIANT_OPTIONS: readonly TableVariant[] = ["KREUZ_4P", "SOLO_4P", "BODENSEE_2P"];

// Kaskaden-Stufen der erlaubten Ansagen ÜBER Trumpf hinaus (Trumpf ist immer
// an). `index` = Position in ANNOUNCE_LEVELS: GEISS_BOCK=1, SLALOM=2, ALLES
// (=+Gumpf)=3. Eine Checkbox ist aktivierbar, sobald die vorige Stufe an ist.
const ANNOUNCE_STEPS = [
  { key: "geissBock", index: 1 },
  { key: "slalom", index: 2 },
  { key: "gumpf", index: 3 },
] as const;

/** KI-Sitze für den „allein gegen KI"-Shortcut — bei Bodensee nur Sitz 1. */
function soloAiSeats(variant: TableVariant): { seat: number }[] {
  return variant === "BODENSEE_2P" ? [{ seat: 1 }] : [{ seat: 1 }, { seat: 2 }, { seat: 3 }];
}

export function OpenTableDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [variant, setVariant] = useState<TableVariant>("KREUZ_4P");
  const [joinMode, setJoinMode] = useState<JoinMode>("OPEN");
  const [aiSeatType, setAiSeatType] = useState<AiSeatType>("heuristic");
  const [autoFill, setAutoFill] = useState<number | null>(30);
  const [restartMode, setRestartMode] = useState<RestartMode>("SIEGER_GIBT");
  const [winMode, setWinMode] = useState<WinMode>("FIRST_TO_TARGET");
  const [targetScore, setTargetScore] = useState<number>(1000);
  const [announceLevel, setAnnounceLevel] = useState<AnnounceLevel>("ALLES");
  const [sackRule, setSackRule] = useState(false);
  const [weisNeedsTrick, setWeisNeedsTrick] = useState(false);
  const [cutEnabled, setCutEnabled] = useState(true);
  const [soloVsAi, setSoloVsAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingTableId, setExistingTableId] = useState<string | null>(null);

  /**
   * Spielart wechseln. Passt das Punkteziel mit an — aber nur, wenn der
   * User es noch nicht selbst von einem Default weg verstellt hat
   * (Heuristik: aktueller Wert == Default der ANDEREN Spielart).
   */
  function changeVariant(next: TableVariant) {
    setVariant(next);
    // Punkteziel nur mitziehen, wenn der User noch auf einem Spielart-Default
    // steht (also nichts Eigenes eingetippt hat).
    if ((Object.values(DEFAULT_SCORE) as number[]).includes(targetScore)) {
      setTargetScore(DEFAULT_SCORE[next]);
    }
  }

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
        setError(t("lobby.openTable.error"));
        setExistingTableId(null);
      }
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setExistingTableId(null);
    const dto: OpenTableDto = {
      variant,
      joinMode,
      aiSeatType,
      autoFillSeconds: autoFill,
      restartMode,
      winMode,
      targetScore,
      announceLevel,
      sackRule,
      weisNeedsTrick,
      cutEnabled,
      initialAiSeats: soloVsAi ? soloAiSeats(variant) : [],
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
      className="rounded-lg p-0 backdrop:bg-black/40 w-full max-w-xl"
    >
      <form onSubmit={submit} className="bg-jass-paper">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-jass-paperEdge">
          <div>
            <h2 className="text-xl font-bold text-jass-ink">{t("lobby.openTable.title")}</h2>
            <p className="text-xs text-jass-inkSoft mt-0.5">{t("lobby.openTable.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("lobby.openTable.close")}
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
                  {variant === "BODENSEE_2P"
                    ? t("lobby.openTable.solo.headingSingle")
                    : t("lobby.openTable.solo.headingMulti")}
                </div>
                <div className="text-xs text-jass-inkSoft mt-0.5">
                  {t("lobby.openTable.solo.hint")}
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

          {/* Spielart */}
          <Section title={t("lobby.openTable.sections.variant")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {VARIANT_OPTIONS.map((opt) => (
                <Tile
                  key={opt}
                  selected={variant === opt}
                  onClick={() => changeVariant(opt)}
                  title={t(`lobby.openTable.variant.${opt}.title`)}
                  hint={t(`lobby.openTable.variant.${opt}.hint`)}
                />
              ))}
            </div>
          </Section>

          {/* Erlaubte Ansage-Arten (Kaskade — Trumpf immer an) */}
          <Section title={t("lobby.openTable.sections.announceLevel")}>
            <div className="space-y-1.5">
              <AnnounceCheck
                checked
                disabled
                label={t("lobby.openTable.announceLevel.trumpf")}
                hint={t("lobby.openTable.announceLevel.trumpfHint")}
                onChange={() => {}}
              />
              {ANNOUNCE_STEPS.map((step) => {
                const levelIdx = ANNOUNCE_LEVELS.indexOf(announceLevel);
                const checked = levelIdx >= step.index;
                const disabled = levelIdx < step.index - 1;
                return (
                  <AnnounceCheck
                    key={step.key}
                    checked={checked}
                    disabled={disabled}
                    label={t(`lobby.openTable.announceLevel.${step.key}`)}
                    hint={t(`lobby.openTable.announceLevel.${step.key}Hint`)}
                    onChange={() =>
                      setAnnounceLevel(ANNOUNCE_LEVELS[checked ? step.index - 1 : step.index]!)
                    }
                  />
                );
              })}
            </div>
          </Section>

          {/* Optionale Wertungsregeln */}
          <Section title={t("lobby.openTable.sections.scoringRules")}>
            <div className="space-y-1.5">
              <AnnounceCheck
                checked={weisNeedsTrick}
                disabled={false}
                label={t("lobby.openTable.scoringRules.weisNeedsTrick")}
                hint={t("lobby.openTable.scoringRules.weisNeedsTrickHint")}
                onChange={() => setWeisNeedsTrick((v) => !v)}
              />
              <AnnounceCheck
                checked={sackRule}
                disabled={false}
                label={t("lobby.openTable.scoringRules.sack")}
                hint={t("lobby.openTable.scoringRules.sackHint")}
                onChange={() => setSackRule((v) => !v)}
              />
              <AnnounceCheck
                checked={cutEnabled}
                disabled={false}
                label={t("lobby.openTable.scoringRules.cut")}
                hint={t("lobby.openTable.scoringRules.cutHint")}
                onChange={() => setCutEnabled((v) => !v)}
              />
            </div>
          </Section>

          {/* Wer darf rein */}
          <Section title={t("lobby.openTable.sections.joinMode")}>
            <TileGrid>
              {JOIN_MODE_OPTIONS.map((opt) => (
                <Tile
                  key={opt}
                  selected={joinMode === opt}
                  onClick={() => setJoinMode(opt)}
                  title={t(`lobby.openTable.joinMode.${opt}.title`)}
                  hint={t(`lobby.openTable.joinMode.${opt}.hint`)}
                />
              ))}
            </TileGrid>
          </Section>

          {/* Gegner-Typ */}
          <Section title={t("lobby.openTable.sections.aiType")}>
            <TileGrid>
              {AI_TYPE_OPTIONS.map((opt) => (
                <Tile
                  key={opt}
                  selected={aiSeatType === opt}
                  onClick={() => setAiSeatType(opt)}
                  title={t(`lobby.openTable.aiType.${opt}.title`)}
                  hint={t(`lobby.openTable.aiType.${opt}.hint`)}
                />
              ))}
            </TileGrid>
          </Section>

          {/* Auto-Fill */}
          <Section title={t("lobby.openTable.sections.autoFill")}>
            <div className="flex flex-wrap gap-2">
              {AUTO_FILL_PRESETS.map((p) => (
                <Pill
                  key={p.label}
                  selected={autoFill === p.value}
                  onClick={() => setAutoFill(p.value)}
                  label={autoFillPresetLabel(t, p.value)}
                />
              ))}
            </div>
            <p className="text-xs text-jass-inkSoft mt-2">
              {autoFill === null
                ? t("lobby.openTable.autoFillHintOff")
                : t("lobby.openTable.autoFillHint", { seconds: autoFill })}
            </p>
          </Section>

          {/* Punkteziel */}
          <Section title={t("lobby.openTable.sections.targetScore")}>
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
                {t("lobby.openTable.targetScoreCustom")}
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
                  aria-label={t("lobby.openTable.targetScoreAria")}
                />
              </label>
            </div>
            <p className="text-xs text-jass-inkSoft mt-2">{t("lobby.openTable.targetScoreHint")}</p>
          </Section>

          {/* Sieg-Modus: wie wird der Partie-Sieger ermittelt, wenn das Ziel
              erreicht ist? */}
          <Section title={t("lobby.openTable.sections.winMode")}>
            <TileGrid>
              {(["FIRST_TO_TARGET", "HIGHEST"] as const).map((opt) => (
                <Tile
                  key={opt}
                  selected={winMode === opt}
                  onClick={() => setWinMode(opt)}
                  title={t(`lobby.openTable.winMode.${opt}.title`)}
                  hint={t(`lobby.openTable.winMode.${opt}.hint`)}
                />
              ))}
            </TileGrid>
          </Section>

          {/* Re-Match-Modus */}
          <Section title={t("lobby.openTable.sections.restart")}>
            <TileGrid>
              {RESTART_OPTIONS.map((opt) => (
                <Tile
                  key={opt}
                  selected={restartMode === opt}
                  onClick={() => setRestartMode(opt)}
                  title={t(`lobby.openTable.restart.${opt}.title`)}
                  hint={t(`lobby.openTable.restart.${opt}.hint`)}
                />
              ))}
            </TileGrid>
          </Section>

          {/* Live-Zusammenfassung */}
          <SummaryRow
            variant={variant}
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
                    {t("lobby.openTable.goToExisting")}
                  </button>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-6 py-4 border-t border-jass-paperEdge bg-jass-cream">
          <button type="button" onClick={onClose} className="btn-jass-secondary">
            {t("lobby.openTable.cancel")}
          </button>
          <button type="submit" disabled={openMut.isPending} className="btn-jass-primary">
            {openMut.isPending ? t("lobby.openTable.opening") : t("lobby.openTable.submit")}
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

/** Eine Kaskaden-Checkbox für die erlaubten Ansage-Arten. */
function AnnounceCheck({
  checked,
  disabled,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 transition ${
        disabled
          ? "cursor-not-allowed border-jass-paperEdge opacity-50"
          : "cursor-pointer border-jass-paperEdge hover:bg-jass-yellow/10"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 accent-jass-yellowDark"
      />
      <span>
        <span className="block text-sm font-medium text-jass-ink">{label}</span>
        <span className="block text-xs leading-snug text-jass-inkSoft">{hint}</span>
      </span>
    </label>
  );
}

function SummaryRow({
  variant,
  joinMode,
  aiSeatType,
  autoFill,
  restartMode,
  targetScore,
  soloVsAi,
}: {
  variant: TableVariant;
  joinMode: JoinMode;
  aiSeatType: AiSeatType;
  autoFill: number | null;
  restartMode: RestartMode;
  targetScore: number;
  soloVsAi: boolean;
}) {
  const { t } = useTranslation();
  const variantLabel = t(`lobby.openTable.variant.${variant}.title`);
  const joinLabel = t(`lobby.openTable.joinMode.${joinMode}.title`);
  const aiLabel = t(`lobby.openTable.aiType.${aiSeatType}.title`);
  const restartLabel = t(`lobby.openTable.restart.${restartMode}.title`);
  return (
    <div className="rounded-lg bg-jass-cream border border-jass-paperEdge px-4 py-3 text-sm">
      <div className="text-xs font-semibold uppercase text-jass-inkSoft mb-1">
        {t("lobby.openTable.summary.heading")}
      </div>
      <div className="text-jass-ink leading-relaxed">
        <span className="font-semibold">{variantLabel}</span> ·{" "}
        {soloVsAi
          ? variant === "BODENSEE_2P"
            ? t("lobby.openTable.summary.soloSingle")
            : t("lobby.openTable.summary.soloMulti")
          : joinLabel}{" "}
        · <span className="font-semibold">{aiLabel}</span> ·{" "}
        {autoFill === null
          ? t("lobby.openTable.summary.noAutoFill")
          : t("lobby.openTable.summary.autoFill", { seconds: autoFill })}{" "}
        · {t("lobby.openTable.summary.target")} <span className="font-semibold">{targetScore}</span>{" "}
        · {restartLabel}
      </div>
    </div>
  );
}

/**
 * Auto-Fill-Preset-Label aus i18n. Die Preset-Werte sind exakt 4 Stufen
 * (15s, 30s, 1min, 2min) + „Aus"; nur diese werden hier abgebildet.
 */
function autoFillPresetLabel(t: TFunction, value: number | null): string {
  if (value === null) return t("lobby.openTable.autoFillPreset.off");
  if (value === 60) return t("lobby.openTable.autoFillPreset.minute");
  if (value < 60) return t("lobby.openTable.autoFillPreset.seconds", { seconds: value });
  return t("lobby.openTable.autoFillPreset.minutes", { minutes: Math.round(value / 60) });
}
