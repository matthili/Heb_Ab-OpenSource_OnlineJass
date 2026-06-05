/**
 * Replay-Route: zeigt ein abgespeichertes Spiel Schritt für Schritt.
 *
 * Sichtbar nur für eingeloggte User; die API liefert das Bundle nur an
 * Teilnehmer (oder Admins). Andere User bekommen 403 → wir rendern
 * eine freundliche Fehlermeldung statt rohem JSON.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { aiName } from "~/features/game/aiNames";
import { ReplayPlayer } from "~/features/replay/ReplayPlayer";
import type { ReplayBundle } from "~/features/replay/types";
import { useReplay } from "~/features/replay/useReplay";
import { api } from "~/lib/api";
import { useSession } from "~/lib/auth-client";

export const Route = createFileRoute("/_auth/replay/$gameId")({
  component: ReplayPage,
});

function ReplayPage() {
  const { t } = useTranslation();
  const { gameId } = Route.useParams();
  const { data: session } = useSession();
  const { data, isLoading, error } = useReplay(gameId);

  if (isLoading) {
    return <p className="text-stone-500">{t("replay.loading")}</p>;
  }
  if (error) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-bold">{t("replay.unavailableTitle")}</h1>
        <p className="text-stone-700">
          {error instanceof Error ? error.message : t("replay.unknownError")}
        </p>
        <p>
          <Link to="/lobby" className="text-sm text-stone-600 underline">
            {t("replay.backToLobby")}
          </Link>
        </p>
      </section>
    );
  }
  if (!data) {
    return <p className="text-stone-500">{t("replay.noBundle")}</p>;
  }

  // Eigenen Sitz finden, sonst Sitz 0 als Default (Admin-View).
  const mySeat = session?.user?.id
    ? (data.bundle.seats.find((s) => s.userId === session.user.id)?.seat ?? 0)
    : 0;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold">{t("replay.title")}</h1>
        <span className="text-sm text-stone-600">
          {new Date(data.bundle.startedAt).toLocaleString("de-AT")}
          {data.bundle.endedAt
            ? ` – ${new Date(data.bundle.endedAt).toLocaleTimeString("de-AT")}`
            : ` (${t("replay.running")})`}
        </span>
        <span className="text-xs rounded bg-stone-100 px-2 py-0.5 text-stone-700">
          {t("replay.specBadge", { ruleVersion: data.bundle.ruleVersion })}
          {data.bundle.modelVersion
            ? t("replay.modelBadge", { modelVersion: data.bundle.modelVersion })
            : ""}
        </span>
        <Link to="/lobby" className="ml-auto text-sm text-stone-600 underline">
          {t("replay.backToLobby")}
        </Link>
      </header>

      {data.error && (
        <div
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {data.error}
        </div>
      )}

      <ShareControls
        gameId={gameId}
        bundle={data.bundle}
        canShare={data.bundle.seats.some((s) => s.userId === session?.user?.id)}
      />

      {data.frames.length > 0 ? (
        <ReplayPlayer bundle={data.bundle} frames={data.frames} mySeat={mySeat} />
      ) : (
        <p className="text-stone-500">{t("replay.noFrames")}</p>
      )}

      {data.bundle.finalScore && (
        <FinalScoreCard
          gameId={gameId}
          finalScore={data.bundle.finalScore}
          seats={data.bundle.seats}
          mySeat={mySeat}
          t={t}
        />
      )}
    </section>
  );
}

function ShareControls({
  gameId,
  bundle,
  canShare,
}: {
  gameId: string;
  bundle: ReplayBundle;
  canShare: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const mut = useMutation({
    mutationFn: (isPublic: boolean) =>
      api<{ publicReplay: boolean }>(`/api/games/${gameId}/replay/visibility`, {
        method: "PATCH",
        body: { isPublic },
      }),
    onSuccess: (result) => {
      // Optimistic-style: lokal die Bundle-Kopie aktualisieren, damit der
      // Toggle ohne refetch sofort den neuen Stand zeigt.
      queryClient.setQueryData<{ bundle: ReplayBundle } | undefined>(
        ["games", gameId, "replay"],
        (old) =>
          old ? { ...old, bundle: { ...old.bundle, publicReplay: result.publicReplay } } : old
      );
    },
  });

  const shareUrl = `${window.location.origin}/r/${gameId}`;

  return (
    <div className="rounded border border-stone-200 bg-stone-50 p-3 space-y-2 text-sm">
      {canShare ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={bundle.publicReplay}
            disabled={mut.isPending}
            onChange={(e) => mut.mutate(e.target.checked)}
            className="size-4"
          />
          <span>
            <Trans i18nKey="replay.share.publicToggle" components={{ strong: <strong /> }} />
          </span>
        </label>
      ) : (
        <p className="text-stone-600 text-xs">{t("replay.share.onlyParticipants")}</p>
      )}
      {bundle.publicReplay && (
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs bg-white border border-stone-300 px-2 py-1 rounded select-all">
            {shareUrl}
          </code>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2_000);
            }}
            className="text-xs rounded border border-stone-300 px-2 py-1 hover:bg-stone-100"
          >
            {copied ? t("replay.share.copied") : t("replay.share.copyLink")}
          </button>
        </div>
      )}
    </div>
  );
}

function FinalScoreCard({
  gameId,
  finalScore,
  seats,
  mySeat,
  t,
}: {
  gameId: string;
  finalScore: { team_card_points: number[]; matsch_team: number | null };
  seats: { seat: number; displayName: string | null; aiSeatType: string | null }[];
  mySeat: number;
  t: TFunction;
}) {
  const myTeam = mySeat % 2;
  const teams: [number, number] = [
    finalScore.team_card_points[0] ?? 0,
    finalScore.team_card_points[1] ?? 0,
  ];
  const seatsInTeam = (team: number): string =>
    seats
      .filter((s) => s.seat % 2 === team)
      .map(
        (s) =>
          s.displayName ??
          (s.aiSeatType
            ? aiName(`${gameId}:${s.seat}`, s.aiSeatType)
            : t("replay.player.seatFallback", { n: s.seat }))
      )
      .join(" + ");

  return (
    <div className="rounded border border-stone-200 bg-white p-4">
      <h2 className="text-lg font-semibold mb-2">{t("replay.finalScore.title")}</h2>
      <table className="text-sm w-full">
        <tbody>
          {[0, 1].map((team) => (
            <tr key={team} className={team === myTeam ? "font-medium" : ""}>
              <td className="py-1 pr-2">
                {t("replay.finalScore.teamRow", { team, players: seatsInTeam(team) })}
              </td>
              <td className="py-1 text-right tabular-nums">{teams[team]}</td>
              <td className="py-1 pl-2">
                {finalScore.matsch_team === team ? t("replay.finalScore.matsch") : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
