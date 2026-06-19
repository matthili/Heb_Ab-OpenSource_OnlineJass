/**
 * Admin → System-Status. Aggregierter Betriebsstatus auf einen Blick:
 * DB + Redis erreichbar, Migrationen aktuell, KI-Engine an/aus, Modus
 * (Self-Host/Prod, Captcha, Konto-Freischaltung) und Laufzeit. Pollt alle 15 s.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { SystemStatus } from "~/features/admin/types";
import { api } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/system")({
  component: SystemStatusPage,
});

type PillKind = "ok" | "warn" | "fail";

function Pill({ kind, label }: { kind: PillKind; label: string }) {
  const cls =
    kind === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : kind === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-rose-300 bg-rose-50 text-rose-900";
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-stone-100 py-2 last:border-0">
      <span className="text-sm text-stone-600">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{children}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded border border-stone-200 p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function SystemStatusPage() {
  const { t } = useTranslation();
  const { data, isPending, isError, dataUpdatedAt } = useQuery<SystemStatus>({
    queryKey: ["admin", "system-status"],
    queryFn: () => api("/api/admin/system-status"),
    refetchInterval: 15_000,
  });

  if (isPending) return <p className="text-stone-500">{t("admin.system.loading")}</p>;
  if (isError || !data) return <p className="text-rose-700">{t("admin.system.error")}</p>;

  const okPill = <Pill kind="ok" label={t("admin.system.reachable")} />;
  const failPill = <Pill kind="fail" label={t("admin.system.unreachable")} />;

  return (
    <section className="max-w-2xl space-y-4">
      <p className="text-sm text-stone-600">{t("admin.system.intro")}</p>

      <Group title={t("admin.system.services")}>
        <Row label={t("admin.system.db")}>{data.db.ok ? okPill : failPill}</Row>
        <Row label={t("admin.system.redis")}>{data.redis.ok ? okPill : failPill}</Row>
        <Row label={t("admin.system.inference")}>
          {data.inference.available ? (
            <Pill kind="ok" label={t("admin.system.inferenceOk")} />
          ) : (
            <Pill kind="warn" label={t("admin.system.inferenceFallback")} />
          )}
        </Row>
        <Row label={t("admin.system.smtp")}>
          <span className="flex items-center justify-end gap-2">
            <code className="text-xs text-stone-500">
              {data.smtp.host}:{data.smtp.port}
            </code>
            {data.smtp.ok ? (
              okPill
            ) : data.mode.accountActivation === "email" ? (
              failPill
            ) : (
              <Pill kind="warn" label={t("admin.system.smtpOptional")} />
            )}
          </span>
        </Row>
        {!data.smtp.ok && data.mode.accountActivation === "email" && (
          <p className="mt-1 text-xs text-amber-700">{t("admin.system.smtpDownNote")}</p>
        )}
        <Row label={t("admin.system.landing")}>
          {data.landing.ok === null ? (
            <span className="text-stone-400">{t("admin.system.notConfigured")}</span>
          ) : data.landing.ok ? (
            okPill
          ) : (
            failPill
          )}
        </Row>
      </Group>

      <Group title={t("admin.system.migrations")}>
        <Row label={t("admin.system.migrationsApplied")}>{data.migrations.applied}</Row>
        <Row label={t("admin.system.migrationsLatest")}>
          {data.migrations.latest ? <code className="text-xs">{data.migrations.latest}</code> : "—"}
        </Row>
      </Group>

      <Group title={t("admin.system.mode")}>
        <Row label="NODE_ENV">
          <code className="text-xs">{data.mode.nodeEnv}</code>
        </Row>
        <Row label={t("admin.system.selfHost")}>
          {data.mode.selfHost ? t("admin.system.yes") : t("admin.system.no")}
        </Row>
        <Row label={t("admin.system.accountActivation")}>
          {data.mode.accountActivation === "admin"
            ? t("admin.system.activationAdmin")
            : t("admin.system.activationEmail")}
        </Row>
        <Row label={t("admin.system.captcha")}>
          {data.mode.captchaEnabled ? (
            <Pill kind="ok" label={t("admin.system.on")} />
          ) : (
            <Pill kind="warn" label={t("admin.system.off")} />
          )}
        </Row>
        {!data.mode.captchaEnabled && (
          <p className="mt-2 text-xs text-amber-700">{t("admin.system.captchaOffNote")}</p>
        )}
      </Group>

      <Group title={t("admin.system.runtime")}>
        <Row label={t("admin.system.nodeVersion")}>
          <code className="text-xs">{data.runtime.nodeVersion}</code>
        </Row>
        <Row label={t("admin.system.uptime")}>{formatUptime(data.runtime.uptimeSeconds)}</Row>
      </Group>

      <p className="text-xs text-stone-400">
        {t("admin.system.checkedAt", { time: new Date(dataUpdatedAt).toLocaleTimeString() })}
      </p>
    </section>
  );
}
