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
import type { Card } from "@jass/engine";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { SeatView } from "~/features/lobby/types";
import { seatDisplayName } from "./aiNames";
import { AnnouncementDialog } from "./AnnouncementDialog";
import { AnnounceOverlay, ModeWatermark } from "./AnnounceVisuals";
import { DealCinematic } from "./DealCinematic";
import { MatschOverlay } from "./MatschOverlay";
import { relativeSlot, SEAT_LABEL_POS } from "./seat-layout";
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
  weisenPending,
  error,
  dealCinematicMode = "full",
  nameSeed,
  onPlayCard,
  onAnnounce,
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

  // Deal-Cinematic-State: solange `dealActive`, ist der AnnouncementDialog
  // versteckt — er erscheint erst nach `onComplete`. Pro gameId einmal.
  // Default `true` für announcing-Phase; die DealCinematic-Komponente
  // selbst entscheidet via localStorage, ob sie wirklich rendert oder
  // gleich onComplete callt (z.B. bei Reload).
  const [dealActive, setDealActive] = useState(true);

  // Ansage-Phase: nur die Hand + Dialog rendern, kein Scoreboard/Spielfeld.
  // Die Variante steht ja noch gar nicht fest, das Scoreboard hätte nichts
  // sinnvolles anzuzeigen.
  if (view.status === "announcing") {
    // WELI-Highlight: Das WELI bestimmt den Ansager NUR beim Match-Start
    // (erste Hand → `dealCinematicMode === "full"`). Danach rotiert der
    // Ansager im Uhrzeigersinn — dann darf die WELI-Enthüllung NICHT mehr
    // erscheinen, auch wenn der rotierte Ansager das WELI zufällig hält.
    const iHaveWeli =
      dealCinematicMode === "full" &&
      view.announcement?.iAmAnnouncer === true &&
      view.hand.some((c) => c.suit === "SCHELLE" && c.rank === "SECHS");
    const announcerSeat = view.announcement?.announcerSeat ?? 0;
    return (
      <div
        className="space-y-4 relative"
        // Mindesthöhe, damit die absolute Cinematic im announcing-Modus
        // Platz hat (sonst wäre der Container nur so hoch wie die Hand
        // unten + Dialog oben — die fliegenden Karten würden geclippt).
        style={{ minHeight: dealActive ? "32rem" : undefined }}
      >
        {/* Deal-Cinematic: spielt einmalig pro gameId und ersetzt das
            alte CutDeckIntro. Solange aktiv, ist der Dialog versteckt. */}
        {dealActive && (
          <DealCinematic
            gameId={view.gameId}
            mySeat={mySeat}
            announcerSeat={announcerSeat}
            mode={dealCinematicMode}
            onComplete={() => setDealActive(false)}
          />
        )}
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
      {view.stoeckEligible && (
        <button
          type="button"
          onClick={onAnnounceStoeck}
          className="w-full rounded-lg bg-jass-yellow border-2 border-jass-yellowDark px-4 py-3 text-jass-ink font-bold text-lg shadow-md hover:bg-jass-yellow/90 jass-your-turn-glow"
        >
          {t("game.stoeck.call")}
        </button>
      )}
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
      />
      <MatschOverlay
        gameId={view.gameId}
        finalScore={view.finalScore}
        mySeat={mySeat}
        teams={state.teams}
        seats={seats}
        nameSeed={nameSeed}
      />
    </div>
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
      <div className="rounded bg-jass-cream border border-jass-paperEdge px-3 py-2 text-jass-ink">
        {t("game.finished")}
      </div>
    );
  }
  if (view.myTurn) {
    return (
      <div className="jass-your-turn-glow rounded bg-jass-yellow border border-jass-yellowDark px-3 py-2 text-jass-ink font-semibold">
        {t("game.yourTurn")}
      </div>
    );
  }
  const playerSeat = seats.find((s) => s.seat === view.whoseTurnSeat);
  const name = playerSeat
    ? seatDisplayName(playerSeat, nameSeed, t("game.seatFallback", { n: view.whoseTurnSeat + 1 }))
    : t("game.seatFallback", { n: view.whoseTurnSeat + 1 });
  return (
    <div className="rounded bg-jass-paper border border-jass-paperEdge px-3 py-2 text-jass-inkSoft">
      <Trans
        i18nKey="game.otherTurn"
        values={{ name }}
        components={{ strong: <strong className="text-jass-ink" /> }}
      />
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
      className="grid grid-cols-3 grid-rows-[auto_1fr_auto] gap-2 min-h-[32rem] h-[clamp(32rem,65vh,48rem)] rounded-lg p-4 relative shadow-inner bg-jass-felt"
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
        const active = view.whoseTurnSeat === s.seat && view.status === "playing";
        const isLastWinner = s.seat === winnerSeat;
        const wrapperCls = [
          SEAT_LABEL_POS[slot],
          "text-sm rounded px-2 py-1 z-10 shadow-sm",
          active
            ? "bg-jass-yellow text-jass-ink font-semibold ring-2 ring-jass-yellowDark jass-seat-active-pulse"
            : isLastWinner
              ? "bg-jass-cream text-jass-ink border border-jass-yellowDark"
              : "bg-jass-paper text-jass-ink",
        ].join(" ");
        const content = (
          <>
            {label}
            {isLastWinner && (
              <span className="ml-1 text-jass-yellowDark" aria-hidden="true">
                ★
              </span>
            )}
          </>
        );
        // Menschliche Sitze sind klickbar → Public-Profile. KI-Sitze
        // bleiben statische Labels (kein Profil zum Anzeigen).
        if (s.user?.id) {
          return (
            <Link
              key={s.seat}
              to="/users/$id"
              params={{ id: s.user.id }}
              className={`${wrapperCls} hover:underline pointer-events-auto`}
            >
              {content}
            </Link>
          );
        }
        return (
          <div key={s.seat} className={wrapperCls}>
            {content}
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
        <TrickMini state={state} mySeat={mySeat} seatNames={seatNames} which="first" />
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
