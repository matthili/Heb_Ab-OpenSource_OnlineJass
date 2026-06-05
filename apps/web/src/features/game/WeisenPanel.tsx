/**
 * **Weisen-Panel** — UI für die Weisen-Phase im ersten Spiel.
 *
 * Drei Anzeige-Zustände (vom Backend gesteuert via `PlayerView.weisen`):
 *
 *   1. **PENDING + canClickButton**: Button „Weisen ansagen" — kompakt
 *      neben dem Stöck-Button.
 *   2. **OPEN (Selection-Mode)**: User wählt Karten aus seiner Hand für
 *      eine Deklaration; kann weitere Gruppen hinzufügen; kann auch
 *      „Doch nix" / „Submit" entscheiden.
 *   3. **SUBMITTED / MISSED / EVALUATED**: kurzer Info-Block — User sieht
 *      seine eigenen abgegebenen Deklarationen. Das `WeisenResultOverlay`
 *      übernimmt die finale Aufdeckung aller Sitze nach Trick 1.
 *
 * **Sicherheit**: Die endgültige Validierung läuft AUSSCHLIESSLICH
 * server-seitig. Wir machen client-seitig nur eine schnelle Vor-Prüfung
 * (mit `validateDeclaration`), damit der User Feedback bekommt, OHNE den
 * Server zu fragen — der Server validiert beim Submit nochmal komplett.
 *
 * **WELI**: Hat im Spiel keine Joker-Funktion. UI behandelt sie als
 * normale Schelle-Sechs.
 */
import { useMemo } from "react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import type { Card } from "@jass/engine";
import { RANK_ID, SUIT_ID, cardsEqual, validateDeclaration } from "@jass/engine";

import type { WeisDeclarationView, WeisenView } from "./types";

interface Props {
  weisen: WeisenView;
  /** Aktuelle Hand des Spielers — Quelle der Karten-Auswahl. */
  hand: readonly Card[];
  weisenPending: boolean;
  onClickWeisen: () => void;
  onSubmitWeisen: (groups: ReadonlyArray<ReadonlyArray<Card>>) => void;
  /**
   * Vom GameBoard gesteuerter Selection-Mode-State. Wenn `true`, blockiert
   * GameBoard die normale Play-Hand und delegiert Klicks an dieses Panel.
   */
  selectionMode: boolean;
  onEnterSelection: () => void;
  onExitSelection: () => void;
  /**
   * Karten die aktuell für die *gerade aufgebaute* Gruppe ausgewählt sind.
   * Liegt im GameBoard, damit auch die Hand-Komponente per `selectedMask`
   * die Auswahl visualisieren kann.
   */
  currentGroup: readonly Card[];
  setCurrentGroup: (cards: readonly Card[]) => void;
  /** Bereits fertig komponierte Gruppen (auf „Weiteren Weis hinzufügen"). */
  finalizedGroups: ReadonlyArray<ReadonlyArray<Card>>;
  setFinalizedGroups: (groups: ReadonlyArray<ReadonlyArray<Card>>) => void;
}

export function WeisenPanel(props: Props) {
  const { t } = useTranslation();
  const {
    weisen,
    hand,
    weisenPending,
    onClickWeisen,
    onSubmitWeisen,
    selectionMode,
    onEnterSelection,
    onExitSelection,
    currentGroup,
    setCurrentGroup,
    finalizedGroups,
    setFinalizedGroups,
  } = props;

  // ── Phase 1: Button „Weisen ansagen" ─────────────────────────────────
  // Sichtbar wenn Server uns das Window öffnet UND wir noch nicht im
  // Selection-Mode sind. Sobald der Klick im Backend angekommen ist
  // (Status wechselt auf OPEN), wechselt der UI-Modus auf Selection.
  if (weisen.canClickButton && !selectionMode) {
    return (
      <button
        type="button"
        onClick={() => {
          onClickWeisen();
          onEnterSelection();
        }}
        disabled={weisenPending}
        className="w-full rounded-lg bg-jass-yellow border-2 border-jass-yellowDark px-4 py-3 text-jass-ink font-bold text-lg shadow-md hover:bg-jass-yellow/90 disabled:opacity-50 jass-your-turn-glow"
        aria-label={t("game.weisen.announceAria")}
      >
        {t("game.weisen.announce")}
      </button>
    );
  }

  // ── Phase 2: Selection-Mode aktiv (Status OPEN oder lokal getoggelt) ─
  if (selectionMode || weisen.myStatus === "OPEN") {
    return (
      <SelectionPanel
        hand={hand}
        weisenPending={weisenPending}
        currentGroup={currentGroup}
        setCurrentGroup={setCurrentGroup}
        finalizedGroups={finalizedGroups}
        setFinalizedGroups={setFinalizedGroups}
        onSubmit={(groups) => {
          onSubmitWeisen(groups);
          onExitSelection();
          setCurrentGroup([]);
          setFinalizedGroups([]);
        }}
        onCancel={() => {
          onExitSelection();
          setCurrentGroup([]);
          setFinalizedGroups([]);
        }}
      />
    );
  }

  // ── Phase 3: SUBMITTED — kompakt Info ───────────────────────────────
  if (weisen.myStatus === "SUBMITTED" && weisen.myDeclarations.length > 0) {
    return (
      <div className="rounded border border-jass-paperEdge bg-jass-paper px-3 py-2 text-sm text-jass-ink">
        <div className="font-semibold mb-1">{t("game.weisen.yoursAnnounced")}</div>
        <ul className="space-y-0.5">
          {weisen.myDeclarations.map((d, i) => (
            <li key={i}>
              <DeclarationLabel d={d} t={t} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-jass-inkSoft mt-1">{t("game.weisen.pointsAfterFirst")}</p>
      </div>
    );
  }

  // ── Sonst: nichts rendern (PENDING-no-window, MISSED, EVALUATED ohne result) ─
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Selection-Panel (Phase 2)
// ─────────────────────────────────────────────────────────────────────

interface SelectionProps {
  hand: readonly Card[];
  weisenPending: boolean;
  currentGroup: readonly Card[];
  setCurrentGroup: (cards: readonly Card[]) => void;
  finalizedGroups: ReadonlyArray<ReadonlyArray<Card>>;
  setFinalizedGroups: (groups: ReadonlyArray<ReadonlyArray<Card>>) => void;
  onSubmit: (groups: ReadonlyArray<ReadonlyArray<Card>>) => void;
  onCancel: () => void;
}

function SelectionPanel(props: SelectionProps) {
  const { t } = useTranslation();
  const {
    hand,
    weisenPending,
    currentGroup,
    finalizedGroups,
    setFinalizedGroups,
    setCurrentGroup,
    onSubmit,
    onCancel,
  } = props;

  // Client-Side-Vor-Validierung — die Wahrheit liegt beim Server, aber
  // hier helfen wir dem User mit unmittelbarem Feedback.
  // Wichtig: Wir validieren gegen die ORIGINAL-Hand abzüglich Karten,
  // die schon in finalizedGroups stecken — sonst würde z.B. „4×Asse"
  // nicht mehr gehen, weil die Engine die Karten nur einmal sieht.
  const remainingHand = useMemo(() => {
    const used = new Set(finalizedGroups.flatMap((g) => g.map((c) => `${c.suit}-${c.rank}`)));
    return hand.filter((c) => !used.has(`${c.suit}-${c.rank}`));
  }, [hand, finalizedGroups]);

  type Validation = { ok: true; points: number; kindLabel: string } | { ok: false; reason: string };
  const validation: Validation | null = useMemo(() => {
    if (currentGroup.length === 0) return null;
    if (currentGroup.length < 3) {
      return { ok: false, reason: t("game.weisen.reason.minThree") };
    }
    const result = validateDeclaration(currentGroup, remainingHand);
    if ("invalid" in result) {
      return {
        ok: false,
        reason: invalidReasonLabel(result.reason, t),
      };
    }
    return {
      ok: true,
      points: result.points,
      kindLabel: kindLabel(result.kind, t),
    };
  }, [currentGroup, remainingHand, t]);

  const totalPoints =
    finalizedGroups.reduce((sum, g) => {
      const r = validateDeclaration(g, hand);
      return sum + ("invalid" in r ? 0 : r.points);
    }, 0) + (validation && validation.ok ? validation.points : 0);

  function addCurrentGroup() {
    if (!validation?.ok) return;
    setFinalizedGroups([...finalizedGroups, [...currentGroup]]);
    setCurrentGroup([]);
  }

  function removeFinalized(idx: number) {
    setFinalizedGroups(finalizedGroups.filter((_, i) => i !== idx));
  }

  function submitAll() {
    const groups: Card[][] = finalizedGroups.map((g) => [...g]);
    if (validation?.ok && currentGroup.length >= 3) {
      groups.push([...currentGroup]);
    }
    if (groups.length === 0) {
      // „Submit leer" = keine Weisen — Server würde das ignorieren bzw.
      // SUBMITTED ohne Deklarationen verbuchen. Wir machen daraus
      // „Cancel" — das ist UX-freundlicher.
      onCancel();
      return;
    }
    onSubmit(groups);
  }

  return (
    <div
      className="rounded-lg border-2 border-jass-yellowDark bg-jass-cream p-3 space-y-3 shadow-md"
      role="region"
      aria-label={t("game.weisen.selectAria")}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="font-bold text-jass-ink">{t("game.weisen.selectTitle")}</h3>
        <span className="text-sm text-jass-inkSoft">
          {t("game.weisen.tapCardsPoints", { points: totalPoints })}
        </span>
      </div>

      {/* Bereits gesammelte Gruppen */}
      {finalizedGroups.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-jass-inkSoft uppercase">
            {t("game.weisen.preselected")}
          </div>
          <ul className="space-y-1">
            {finalizedGroups.map((g, i) => {
              const r = validateDeclaration(g, hand);
              if ("invalid" in r) return null;
              return (
                <li
                  key={i}
                  className="flex items-center justify-between rounded bg-jass-paper px-2 py-1 text-sm"
                >
                  <span>
                    {t("game.weisen.groupSummary", {
                      kind: kindLabel(r.kind, t),
                      points: r.points,
                    })}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-jass-red hover:underline"
                    onClick={() => removeFinalized(i)}
                  >
                    {t("game.weisen.remove")}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Aktuelle Auswahl */}
      <div className="text-sm">
        {currentGroup.length === 0 ? (
          <p className="text-jass-inkSoft italic">{t("game.weisen.tapHint")}</p>
        ) : (
          <p>
            <Trans
              i18nKey="game.weisen.selectedCount"
              count={currentGroup.length}
              values={{ count: currentGroup.length }}
              components={{ strong: <strong /> }}
            />
            {validation?.ok ? (
              <span className="text-jass-green ml-1">
                {t("game.weisen.validOk", {
                  kind: validation.kindLabel,
                  points: validation.points,
                })}
              </span>
            ) : validation ? (
              <span className="text-jass-red ml-1">
                {t("game.weisen.validReason", { reason: validation.reason })}
              </span>
            ) : null}
          </p>
        )}
      </div>

      {/* Aktions-Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addCurrentGroup}
          disabled={!validation?.ok || weisenPending}
          className="rounded bg-jass-paper border border-jass-paperEdge px-3 py-1.5 text-sm font-semibold text-jass-ink hover:bg-jass-paper/70 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("game.weisen.addAnother")}
        </button>
        <button
          type="button"
          onClick={submitAll}
          disabled={weisenPending || (finalizedGroups.length === 0 && !validation?.ok)}
          className="rounded bg-jass-yellow border-2 border-jass-yellowDark px-3 py-1.5 text-sm font-bold text-jass-ink hover:bg-jass-yellow/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("game.weisen.submit")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={weisenPending}
          className="rounded bg-transparent border border-jass-paperEdge px-3 py-1.5 text-sm text-jass-inkSoft hover:bg-jass-paper disabled:opacity-40"
        >
          {t("game.weisen.discard")}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Hand-Click-Toggle-Helper — für GameBoard exportiert, damit Hand-Klicks
// im Selection-Mode den `currentGroup`-State updaten können.
// ─────────────────────────────────────────────────────────────────────

export function toggleCardInGroup(group: readonly Card[], card: Card): readonly Card[] {
  const idx = group.findIndex((c) => cardsEqual(c, card));
  if (idx >= 0) {
    return group.filter((_, i) => i !== idx);
  }
  return [...group, card].sort((a, b) => {
    const s = SUIT_ID[a.suit] - SUIT_ID[b.suit];
    if (s !== 0) return s;
    return RANK_ID[a.rank] - RANK_ID[b.rank];
  });
}

// ─────────────────────────────────────────────────────────────────────
// Label-Helpers (auch vom Result-Overlay genutzt)
// ─────────────────────────────────────────────────────────────────────

export function kindLabel(kind: string, t: TFunction): string {
  if (kind === "FOUR_OF_A_KIND") return t("game.weisen.kindFourOfAKind");
  const m = /^SEQUENCE_(\d+)$/.exec(kind);
  if (m) return t("game.weisen.kindSequence", { n: m[1] });
  return kind;
}

function invalidReasonLabel(reason: string, t: TFunction): string {
  switch (reason) {
    case "TOO_FEW_CARDS":
      return t("game.weisen.reason.tooFew");
    case "TOO_MANY_CARDS":
      return t("game.weisen.reason.tooMany");
    case "DUPLICATE_CARDS":
      return t("game.weisen.reason.duplicate");
    case "CARD_NOT_IN_HAND":
      return t("game.weisen.reason.notInHand");
    case "NOT_A_VALID_PATTERN":
      return t("game.weisen.reason.noPattern");
    default:
      return t("game.weisen.reason.invalid");
  }
}

function DeclarationLabel({ d, t }: { d: WeisDeclarationView; t: TFunction }) {
  return (
    <Trans
      i18nKey="game.weisen.declarationLabel"
      values={{ kind: kindLabel(d.kind, t), points: d.points }}
      components={{ strong: <strong /> }}
    />
  );
}
