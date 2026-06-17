/**
 * Spielfläche. Komponenten-Mix:
 *   - `Scoreboard` (Punkte/Trumpf-Anzeige)
 *   - Status-Banner („du bist dran" / Spieler X)
 *   - `PlayingArea`: Sitz-Labels an den 4 Rändern + `Trick` in der Mitte
 *   - `TrickMini` in den unteren Ecken (links: erster Stich der Runde,
 *     rechts: letzter abgeschlossener Stich)
 *   - `Hand` mit den eigenen Karten als Fan
 *
 * **Trick-Linger**: Der zentrale Trick wird vom `useDisplayedTrick`-Hook
 * verzögert — wenn die 4. Karte gespielt wird, bleibt der volle Stich
 * inkl. Gewinner-Highlight 1,5 s sichtbar.
 *
 * **Drehrichtung**: Sitz-Labels und Trick-Positionen folgen Uhrzeigersinn
 * (siehe `seat-layout.ts`).
 */
import { Hand, Scoreboard, Trick } from "@jass/ui";
import { effectiveVariant } from "@jass/engine";
import type { Card } from "@jass/engine";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { SeatView } from "~/features/lobby/types";
import { aiSeatTooltip, seatDisplayName, shortName } from "./aiNames";
import { AnnouncementDialog } from "./AnnouncementDialog";
import { AnnounceOverlay, ModeWatermark } from "./AnnounceVisuals";
import { DealCinematic } from "./DealCinematic";
import { MatschOverlay } from "./MatschOverlay";
import { VoidOverlay } from "./VoidOverlay";
import { relativeSlot, SEAT_LABEL_POS } from "./seat-layout";
import { UserName } from "~/features/social/UserName";
import type { AnnouncementDecision, PlayerView } from "./types";
import { useDisplayedTrick } from "./useDisplayedTrick";
import { TrickMini } from "./TrickMini";
import { toggleCardInGroup, WeisenPanel } from "./WeisenPanel";
import { WeisenResultOverlay } from "./WeisenResultOverlay";

interface Props {
  view: PlayerView;
  seats: readonly SeatView[];
  mySeat: number;
  movePending: boolean;
  announcePending: boolean;
  cutPending: boolean;
  weisenPending: boolean;
  error: string | null;
  /**
   * Soll die Deal-Cinematic im Voll- oder Kurz-Modus laufen?
   * - "full": Misch + Stapel + Abheben + Verteilen + WELI (Spiel 1)
   * - "short": nur Verteilen + WELI-Reveal (Re-Match, Spiel 2+)
   * Default `full` für Backwards-Kompat.
   */
  dealCinematicMode?: "full" | "short";
  /** Seed für stabile KI-Namen (= Tisch-ID, konstant über die ganze Partie). */
  nameSeed: string;
  onPlayCard: (card: Card) => void;
  onAnnounce: (decision: AnnouncementDecision) => void;
  onCut: (cutIndex: number) => void;
  onAnnounceStoeck: () => void;
  onClickWeisen: () => void;
  onSubmitWeisen: (groups: ReadonlyArray<ReadonlyArray<Card>>) => void;
}

export function GameBoard({
  view,
  seats,
  mySeat,
  movePending,
  announcePending,
  cutPending,
  weisenPending,
  error,
  dealCinematicMode = "full",
  nameSeed,
  onPlayCard,
  onAnnounce,
  onCut,
  onAnnounceStoeck,
  onClickWeisen,
  onSubmitWeisen,
}: Props) {
  const { t } = useTranslation();
  const seatNames = buildSeatNames(seats, nameSeed, (n) => t("game.seatFallback", { n }));
  // Hook IMMER auf gleichem Render-Level aufrufen — auch im Ansage-Modus,
  // damit React keine "different number of hooks"-Warnung wirft. Der Hook
  // toleriert `undefined` als no-op.
  const displayed = useDisplayedTrick(view.state ?? undefined);

  // Weisen-Selection-State lebt im GameBoard, weil der WeisenPanel UND die
  // Hand-Komponente beide darauf zugreifen müssen.
  const [selectionMode, setSelectionMode] = useState(false);
  const [currentGroup, setCurrentGroup] = useState<readonly Card[]>([]);
  const [finalizedGroups, setFinalizedGroups] = useState<ReadonlyArray<ReadonlyArray<Card>>>([]);

  // Deal-Cinematic: läuft als durchgehendes Overlay (siehe die Returns unten) —
  // einmal pro Hand und IMMER bis zum Ende, auch wenn der Server (schnelle
  // KI-Ansage) schon auf `playing` springt. Würde die Cinematic im Ansage-Zweig
  // hängen, schnitte der Phasenwechsel sie ab; als Overlay über beiden Zweigen
  // bleibt sie gemountet. `deal` hält gameId + Ansager-Sitz fest, sobald die
  // Ansage-Phase beginnt; `onComplete` räumt es weg. (Die DealCinematic selbst
  // überspringt via localStorage bereits gesehene gameIds + reduced-motion und
  // callt dann sofort onComplete.)
  const [deal, setDeal] = useState<{ gameId: string; announcerSeat: number } | null>(null);
  // Pro gameId nur EINMAL starten — auch nachdem `deal` schon wieder null ist
  // (sonst triggerte der Effect die Cinematic in der Ansage-Phase neu).
  const dealStartedFor = useRef<string | null>(null);
  useEffect(() => {
    if (
      view.status === "announcing" &&
      view.announcement &&
      dealStartedFor.current !== view.gameId
    ) {
      dealStartedFor.current = view.gameId;
      setDeal({ gameId: view.gameId, announcerSeat: view.announcement.announcerSeat });
    }
  }, [view.status, view.gameId, view.announcement?.announcerSeat]);
  // `dealActive` synchron (ohne 1-Frame-Flacker): bereits true, sobald die
  // Ansage-Phase für eine neue gameId da ist — im selben Render, bevor der
  // Effect `deal` setzt. Solange aktiv, ist der Ansage-Dialog versteckt.
  const dealActive =
    deal !== null ||
    (view.status === "announcing" && !!view.announcement && dealStartedFor.current !== view.gameId);
  const dealOverlay = deal ? (
    <DealCinematic
      gameId={deal.gameId}
      mySeat={mySeat}
      announcerSeat={deal.announcerSeat}
      mode={dealCinematicMode}
      onComplete={() => setDeal(null)}
    />
  ) : null;

  // Ansage-Phase: nur die Hand + Dialog rendern, kein Scoreboard/Spielfeld.
  // Die Variante steht ja noch gar nicht fest, das Scoreboard hätte nichts
  // sinnvolles anzuzeigen.
  // Abheben-Phase: Karten noch nicht ausgeteilt — nur die Cut-UI zeigen
  // (Schieberegler + Klopfen für den Abheber; sonst „… hebt ab").
  if (view.status === "announcing" && view.cut) {
    return (
      <div className="space-y-4 relative" style={{ minHeight: "20rem" }}>
        {error && (
          <div
            role="alert"
            className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
          >
            {error}
          </div>
        )}
        <CutPhase cut={view.cut} seatNames={seatNames} onCut={onCut} pending={cutPending} />
      </div>
    );
  }

  if (view.status === "announcing") {
    // WELI-Highlight: Der WELI bestimmt den Ansager NUR beim Match-Start
    // (erste Hand → `dealCinematicMode === "full"`). Danach rotiert der
    // Ansager im Uhrzeigersinn — dann darf die WELI-Enthüllung NICHT mehr
    // erscheinen. Wir binden es an `iAmAnnouncer` (= WELI-Halter aus der
    // Ermittlung), NICHT an die reale Hand: durch das echte Abheben wird die
    // Spielhand neu verteilt und enthält den WELI evtl. gar nicht mehr.
    const iHaveWeli = dealCinematicMode === "full" && view.announcement?.iAmAnnouncer === true;
    return (
      // `relative` + Mindesthöhe, damit das absolute Deal-Overlay im
      // announcing-Modus Platz hat (sonst nur so hoch wie Hand + Dialog → die
      // fliegenden Karten würden geclippt). Das Overlay (dealOverlay) steht hier
      // UND im Playing-Return an gleicher Stelle → React behält es über den
      // Phasenwechsel hinweg gemountet (Animation läuft bis zum Ende).
      <div className="relative" style={dealActive ? { minHeight: "32rem" } : undefined}>
        {dealOverlay}
        <div className="space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {error}
            </div>
          )}
          {!dealActive && iHaveWeli && (
            <div
              role="status"
              aria-live="polite"
              className="jass-weli-banner rounded-lg border-2 border-jass-yellowDark bg-gradient-to-r from-jass-yellow/30 via-jass-yellow/50 to-jass-yellow/30 px-4 py-3 text-center text-jass-ink font-bold shadow-md"
            >
              {t("game.weli.youHaveWeli")}
            </div>
          )}
          {!dealActive && (
            <>
              <AnnouncementDialog
                view={view}
                seatNames={seatNames}
                pending={announcePending}
                onAnnounce={onAnnounce}
              />
              {/* Hand zeigen, damit der Ansager beim Auswählen seine Karten sieht. */}
              <Hand cards={view.hand} highlightWeli={iHaveWeli} />
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Playing / Finished: regulärer Game-Board-Render ────────────────
  const state = view.state!; // status !== announcing → state ist garantiert da
  const variant = state.variant;

  // Solo-Jass erkennen: jeder Sitz hat ein eigenes Team (4 unterschiedliche
  // Team-IDs). Dann zeigt das Scoreboard 4 Einzelkonten statt own/opp.
  const isSolo = new Set(state.teams).size === state.teams.length;
  const soloPlayers =
    isSolo && state.team_card_points
      ? state.teams.map((teamId, seat) => ({
          label:
            seat === mySeat
              ? t("game.you")
              : (seatNames.get(seat) ?? t("game.seatFallback", { n: seat + 1 })),
          points: state.team_card_points![teamId] ?? 0,
          isMe: seat === mySeat,
        }))
      : undefined;

  return (
    <div className="relative" style={dealActive ? { minHeight: "32rem" } : undefined}>
      {dealOverlay}
      <div className="space-y-4">
        <Scoreboard
          ownTeamScore={state.own_team_score}
          oppTeamScore={state.opp_team_score}
          trickIdx={state.trick_idx}
          // Bei Slalom den STABILEN Startmodus + slalom-Flag zeigen, nicht die
          // pro-Stich wechselnde effektive Variante (sonst stünde mal „Oben",
          // mal „Unten" da statt „Slalom").
          mode={state.announcement.slalom ? state.announcement.variant.mode : variant.mode}
          {...(variant.trump_suit !== undefined ? { trumpSuit: variant.trump_suit } : {})}
          {...(state.announcement.slalom ? { slalom: true } : {})}
          {...(soloPlayers ? { soloPlayers } : {})}
        />
        <StatusBanner view={view} seats={seats} nameSeed={nameSeed} />
        {error && (
          <div
            role="alert"
            className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
          >
            {error}
          </div>
        )}
        <PlayingArea
          view={view}
          state={state}
          seats={seats}
          mySeat={mySeat}
          displayedCards={displayed.cards}
          displayedStarter={displayed.starter}
          {...(displayed.winnerSeat !== undefined ? { winnerSeat: displayed.winnerSeat } : {})}
          seatNames={seatNames}
          lingering={displayed.lingering}
        />
        <Hand
          cards={view.hand}
          legalMask={view.legalActionMask}
          canPlay={view.myTurn && !movePending && !selectionMode}
          onPlay={onPlayCard}
          selectionMode={selectionMode}
          selected={currentGroup}
          onSelect={(card) => setCurrentGroup(toggleCardInGroup(currentGroup, card))}
        />
        {/* Stöck-Button UNTER der Hand — im selben Bereich wie das Weisen
          (User-Feedback: vorher war er oberhalb des Spielfelds, der Weisen-
          Button aber unten — verwirrend). Auf der letzten Karte (Hand leer)
          läuft eine sichtbare Frist — danach wird der Stöck automatisch
          angesagt (Server-Gnadenfrist), damit nichts hängt. */}
        {view.stoeckEligible && (
          <StoeckButton lastCard={view.hand.length === 0} onCall={onAnnounceStoeck} />
        )}
        {/* Weise-Panel UNTER der Hand: User-Feedback aus erster Demo. Der
          Button war oberhalb der Spielfläche zu weit weg von den Karten,
          die er auswählen soll — jetzt direkt anschließend, damit Hand
          und Auswahl räumlich zusammenliegen. */}
        <WeisenPanel
          weisen={view.weisen}
          hand={view.hand}
          weisenPending={weisenPending}
          onClickWeisen={onClickWeisen}
          onSubmitWeisen={onSubmitWeisen}
          selectionMode={selectionMode}
          onEnterSelection={() => setSelectionMode(true)}
          onExitSelection={() => setSelectionMode(false)}
          currentGroup={currentGroup}
          setCurrentGroup={setCurrentGroup}
          finalizedGroups={finalizedGroups}
          setFinalizedGroups={setFinalizedGroups}
        />
        <WeisenResultOverlay
          gameId={view.gameId}
          weisen={view.weisen}
          seats={seats}
          mySeat={mySeat}
          nameSeed={nameSeed}
          teams={state.teams}
        />
        <MatschOverlay
          gameId={view.gameId}
          finalScore={view.finalScore}
          mySeat={mySeat}
          teams={state.teams}
          seats={seats}
          nameSeed={nameSeed}
        />
        <VoidOverlay
          gameId={view.gameId}
          finalScore={view.finalScore}
          mySeat={mySeat}
          teams={state.teams}
        />
      </div>
    </div>
  );
}

/**
 * **Abheben-Phase** (echtes Cut-the-Deck). Der Abheber zieht einen
 * Schieberegler (1..deckSize-1) und hebt ab — oder klopft (= nicht abheben).
 * Andere Sitze sehen nur „… hebt ab".
 */
function CutPhase({
  cut,
  seatNames,
  onCut,
  pending,
}: {
  cut: NonNullable<PlayerView["cut"]>;
  seatNames: ReadonlyMap<number, string>;
  onCut: (cutIndex: number) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(Math.floor(cut.deckSize / 2));

  if (!cut.iAmCutter) {
    const name = seatNames.get(cut.cutterSeat) ?? t("game.seatFallback", { n: cut.cutterSeat + 1 });
    return (
      <div className="rounded-lg border border-jass-paperEdge bg-jass-cream px-4 py-8 text-center text-jass-inkSoft">
        <div className="mb-2 text-4xl">🂠</div>
        {t("game.cut.waiting", { name })}
      </div>
    );
  }

  return (
    <section className="rounded-lg border-2 border-jass-yellowDark bg-jass-yellow/15 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-jass-ink">{t("game.cut.title")}</h3>
        <p className="mt-1 text-sm text-jass-inkSoft">{t("game.cut.explain")}</p>
      </div>
      {/* Stilisierter verdeckter Stapel */}
      <div className="flex justify-center py-2">
        <div className="relative h-28 w-20">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute h-28 w-20 rounded-md border border-jass-brownDark bg-gradient-to-br from-jass-brownDark to-stone-700 shadow"
              style={{ top: i * 2, left: i * 2 }}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <input
          type="range"
          min={1}
          max={cut.deckSize - 1}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          disabled={pending}
          className="w-full accent-jass-yellowDark"
          aria-label={t("game.cut.sliderAria")}
        />
        <div className="text-center text-sm font-semibold text-jass-ink">
          {t("game.cut.position", { n: value })}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => onCut(value)}
          disabled={pending}
          className="btn-jass-primary disabled:opacity-50"
        >
          {t("game.cut.cut")}
        </button>
        <button
          type="button"
          onClick={() => onCut(0)}
          disabled={pending}
          className="rounded border-2 border-jass-yellowDark bg-jass-cream px-4 py-2 text-sm font-bold text-jass-ink hover:bg-jass-yellow/20 disabled:opacity-50"
        >
          {t("game.cut.knock")}
        </button>
      </div>
    </section>
  );
}

/**
 * „Stöck rufen"-Button. Auf der letzten Karte (`lastCard`) zeigt er eine
 * ablaufende Frist (rein kosmetisch, Server-Gnadenfrist ist maßgeblich) —
 * danach sagt der Server den Stöck automatisch an, damit die Runde nicht hängt.
 */
function StoeckButton({ lastCard, onCall }: { lastCard: boolean; onCall: () => void }) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(7);
  useEffect(() => {
    if (!lastCard) return;
    setRemaining(7);
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [lastCard]);
  return (
    <button
      type="button"
      onClick={onCall}
      className="jass-your-turn-glow w-full rounded-lg border-2 border-jass-yellowDark bg-jass-yellow px-4 py-3 text-lg font-bold text-jass-ink shadow-md hover:bg-jass-yellow/90"
    >
      {lastCard ? t("game.stoeck.callTimed", { n: remaining }) : t("game.stoeck.call")}
    </button>
  );
}

function StatusBanner({
  view,
  seats,
  nameSeed,
}: {
  view: PlayerView;
  seats: readonly SeatView[];
  nameSeed: string;
}) {
  const { t } = useTranslation();
  if (view.status === "finished") {
    return (
      <div className="rounded bg-jass-cream border border-jass-paperEdge px-3 py-2 text-jass-ink flex items-center h-[2.75rem] overflow-hidden whitespace-nowrap">
        {t("game.finished")}
      </div>
    );
  }
  if (view.myTurn) {
    return (
      <div className="jass-your-turn-glow rounded bg-jass-yellow border border-jass-yellowDark px-3 py-2 text-jass-brownDark font-semibold flex items-center h-[2.75rem] overflow-hidden whitespace-nowrap">
        {t("game.yourTurn")}
      </div>
    );
  }
  const playerSeat = seats.find((s) => s.seat === view.whoseTurnSeat);
  const name = playerSeat
    ? seatDisplayName(playerSeat, nameSeed, t("game.seatFallback", { n: view.whoseTurnSeat + 1 }))
    : t("game.seatFallback", { n: view.whoseTurnSeat + 1 });
  // Ist gerade eine KI am Zug, den Engine-Tooltip auch hier zeigen — das ist
  // buchstäblich „welche Engine werkelt GERADE".
  const aiTitle =
    playerSeat && !playerSeat.user?.id && playerSeat.aiSeatType
      ? aiSeatTooltip(t, playerSeat.aiSeatType, view.inferenceAvailable)
      : "";
  return (
    <div className="rounded bg-jass-paper border border-jass-paperEdge px-3 py-2 text-jass-inkSoft flex items-center min-h-[2.75rem]">
      <span
        className={aiTitle ? "cursor-help" : undefined}
        {...(aiTitle ? { title: aiTitle } : {})}
      >
        <Trans
          i18nKey="game.otherTurn"
          values={{ name }}
          components={{ strong: <strong className="text-jass-ink" /> }}
        />
      </span>
    </div>
  );
}

/**
 * Die zentrale Spielfläche: Sitz-Labels an den 4 Rand-Slots, Trick in
 * der Mitte (mit Linger-Effekt), Mini-Anzeige des vorletzten Stichs
 * unten rechts.
 */
function PlayingArea({
  view,
  state,
  seats,
  mySeat,
  displayedCards,
  displayedStarter,
  winnerSeat,
  seatNames,
  lingering,
}: {
  view: PlayerView;
  state: NonNullable<PlayerView["state"]>;
  seats: readonly SeatView[];
  mySeat: number;
  displayedCards: readonly Card[];
  displayedStarter: number;
  winnerSeat?: number;
  seatNames: ReadonlyMap<number, string>;
  lingering: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      // Spielfläche mit Filz-Textur (bg-jass-felt — CSS-Pattern aus
      // gekreuzten Linear-Gradients, kein PNG). Min-Höhe 32rem damit die
      // h-32-Karten in den 3×3-Slots ohne Überlappung passen; clamp
      // skaliert auf großen Bildschirmen bis 48rem hoch.
      // `svh` statt `vh`: die „small viewport height" ändert sich NICHT, wenn
      // mobil die URL-Leiste beim Scrollen ein-/ausblendet → der Tisch behält
      // seine Größe (sonst „hüpfte" das ganze Layout beim Scrollen).
      className="grid grid-cols-3 grid-rows-[auto_1fr_auto] gap-2 min-h-[32rem] h-[clamp(32rem,65svh,48rem)] rounded-lg p-4 relative bg-jass-felt"
      style={{ border: "2px solid var(--color-jass-brownDark)" }}
      role="region"
      aria-label={t("game.playingArea")}
    >
      <ModeWatermark
        info={{
          mode: state.announcement.variant.mode,
          trumpSuit: state.announcement.variant.trump_suit,
          slalom: state.announcement.slalom,
        }}
        // Während des Linger den Modus des EINGEFRORENEN Stichs zeigen, nicht
        // den schon weitergedrehten `state.variant` — sonst springt das Label
        // (z.B. „Unten/Geiss" → „Oben/Bock") schon, während die alten Karten
        // noch liegen. Bei Nicht-Slalom liefert effectiveVariant konstant denselben.
        currentMode={
          lingering && state.completed_tricks.length > 0
            ? effectiveVariant(state.announcement, state.completed_tricks.length - 1).mode
            : state.variant.mode
        }
      />
      <AnnounceOverlay
        gameId={view.gameId}
        info={{
          mode: state.announcement.variant.mode,
          trumpSuit: state.announcement.variant.trump_suit,
          slalom: state.announcement.slalom,
        }}
      />
      {/* Sitz-Labels der 3 Mitspieler */}
      {seats.map((s) => {
        if (s.seat === mySeat) return null;
        const slot = relativeSlot(s.seat, mySeat);
        const label = seatNames.get(s.seat) ?? "—";
        // Engine-Status-Tooltip am KI-Chip (Name bleibt stabil): „Engine OK"
        // bzw. „Heuristik-Fallback", wenn NN gewählt ist, der Inferenz-Dienst
        // aber nicht läuft.
        const aiTitle =
          !s.user?.id && s.aiSeatType
            ? aiSeatTooltip(t, s.aiSeatType, view.inferenceAvailable)
            : "";
        const active = view.whoseTurnSeat === s.seat && view.status === "playing";
        const isLastWinner = s.seat === winnerSeat;
        const wrapperCls = [
          SEAT_LABEL_POS[slot],
          "text-sm rounded px-2 py-1 z-10 shadow-sm",
          active
            ? "bg-jass-yellow text-jass-ink font-semibold ring-2 ring-jass-yellowDark jass-seat-active-pulse"
            : isLastWinner
              ? // ring statt border: box-shadow-basiert → ändert die Label-Größe
                // NICHT. Ein echter `border` machte das Gewinner-Label 2 px höher,
                // und weil der Letzter-Stich-Gewinner jeden Stich wechselt, staucht
                // das die mittlere Zeile → das UI „hüpfte" leicht beim Zugwechsel.
                "bg-jass-cream text-jass-ink ring-1 ring-jass-yellowDark"
              : "bg-jass-paper text-jass-ink",
        ].join(" ");
        // Menschliche Sitze → klickbarer <UserName> (Menü: PN/Profil/Freund).
        // KI-Sitze bleiben statische Labels (keine Interaktion).
        return (
          <div
            key={s.seat}
            className={`${wrapperCls} pointer-events-auto`}
            {...(aiTitle ? { title: aiTitle } : {})}
          >
            {s.user?.id ? <UserName userId={s.user.id} name={label} /> : label}
            {isLastWinner && (
              <span className="ml-1 text-jass-yellowDark" aria-hidden="true">
                ★
              </span>
            )}
          </div>
        );
      })}

      {/* Trick in der Mitte — mit Linger-Effekt (über dem Modus-Wasserzeichen) */}
      <div className="row-start-1 row-end-4 col-start-1 col-end-4 pointer-events-none relative z-10">
        <Trick
          cards={displayedCards}
          starter={displayedStarter}
          mySeat={mySeat}
          {...(winnerSeat !== undefined ? { winnerSeat } : {})}
        />
      </div>

      {/* Erster Stich der Runde — unten links, bleibt sichtbar
          während der ganzen Runde (Vorarlberger Tradition: man darf
          den ersten Stich nochmal anschauen). */}
      <div className="row-start-3 col-start-1 self-end justify-self-start z-20 pointer-events-auto">
        {/* Im 1. Stich (bis er voll ist) zeigen wir die Rollen: Ansager (WELI),
            Geber, Abheber. Danach steht hier wieder der erste Stich zum
            Nachschauen — gleicher Platz, zeitlich getrennt (Stich 0 ist erst
            nach 4 Karten „fertig" und damit anschaubar). */}
        {state.trick_idx === 0 ? (
          <RoleHints state={state} seatNames={seatNames} />
        ) : (
          <TrickMini state={state} mySeat={mySeat} seatNames={seatNames} which="first" />
        )}
      </div>

      {/* Letzter abgeschlossener Stich — unten rechts. Während Linger
          ausgeblendet (zentrale Anzeige zeigt ihn schon). */}
      <div className="row-start-3 col-start-3 self-end justify-self-end z-20 pointer-events-auto">
        <TrickMini
          state={state}
          mySeat={mySeat}
          seatNames={seatNames}
          which="last"
          hideBecauseLingering={lingering}
        />
      </div>
    </div>
  );
}

/**
 * Rollen-Hinweis im 1. Stich (links unten): wer ansagen darf (WELI-Halter),
 * wer gab und wer abhob. Anker ist der Ansager = `current_trick_starter` — im
 * 1. Stich ist das der Runden-Starter (nach Vorarlberger Tradition auch nach
 * einem Push der Original-Ansager, siehe game.service). Geber = Ansager − 1,
 * Abheber = Ansager − 2 (mod Spielerzahl) → bei Kreuz/Solo drei verschiedene
 * Sitze; Geber ist NIE der Ansager.
 */
function RoleHints({
  state,
  seatNames,
}: {
  state: NonNullable<PlayerView["state"]>;
  seatNames: ReadonlyMap<number, string>;
}) {
  const { t } = useTranslation();
  const n = state.num_players;
  const announcer = state.current_trick_starter;
  const dealer = (announcer + n - 1) % n;
  const cutter = (announcer + n - 2) % n;
  const nameOf = (seat: number) => shortName(seatNames.get(seat) ?? `#${seat + 1}`);
  return (
    <div className="max-w-[12rem] space-y-0.5 rounded bg-jass-paper/90 px-2 py-1 text-xs leading-tight text-jass-ink shadow-sm ring-1 ring-jass-paperEdge">
      <div>{t("game.roleHints.announcer", { name: nameOf(announcer) })}</div>
      <div>{t("game.roleHints.dealer", { name: nameOf(dealer) })}</div>
      <div>{t("game.roleHints.cutter", { name: nameOf(cutter) })}</div>
    </div>
  );
}

function buildSeatNames(
  seats: readonly SeatView[],
  nameSeed: string,
  seatFallback: (n: number) => string
): ReadonlyMap<number, string> {
  const m = new Map<number, string>();
  for (const s of seats) {
    m.set(s.seat, seatDisplayName(s, nameSeed, seatFallback(s.seat)));
  }
  return m;
}
