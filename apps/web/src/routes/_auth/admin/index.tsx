import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";

import { api } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/")({
  component: AdminDashboard,
});

/** Live-Status des KI-Inferenz-Service (relevant für „nn"-Sitze). */
function InferenceStatusBanner() {
  const { t } = useTranslation();
  const { data, isPending } = useQuery<{ available: boolean }>({
    queryKey: ["admin", "inference-status"],
    queryFn: () => api("/api/admin/inference-status"),
    refetchInterval: 30_000,
  });
  if (isPending) return <p className="text-sm text-stone-500">{t("admin.inference.checking")}</p>;
  const ok = data?.available === true;
  return (
    <div
      className={`rounded border px-3 py-2 text-sm ${
        ok
          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <strong>{t("admin.inference.title")}:</strong>{" "}
      {ok ? t("admin.inference.ok") : t("admin.inference.down")}
    </div>
  );
}

function AdminDashboard() {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <p className="text-stone-600">{t("admin.index.intro")}</p>
      <InferenceStatusBanner />
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          to="/admin/settings"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>{t("admin.index.settings.title")}</strong>
          <p className="text-sm text-stone-500">{t("admin.index.settings.desc")}</p>
        </Link>
        <Link
          to="/admin/smtp"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>{t("admin.index.smtp.title")}</strong>
          <p className="text-sm text-stone-500">{t("admin.index.smtp.desc")}</p>
        </Link>
        <Link
          to="/admin/users"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>{t("admin.index.users.title")}</strong>
          <p className="text-sm text-stone-500">{t("admin.index.users.desc")}</p>
        </Link>
        <Link
          to="/admin/blocklist"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>{t("admin.index.blocklist.title")}</strong>
          <p className="text-sm text-stone-500">{t("admin.index.blocklist.desc")}</p>
        </Link>
        <Link
          to="/admin/banned-words"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>{t("admin.index.bannedWords.title")}</strong>
          <p className="text-sm text-stone-500">
            <Trans i18nKey="admin.index.bannedWords.desc" components={{ code: <code /> }} />
          </p>
        </Link>
        <Link
          to="/admin/audit"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>{t("admin.index.audit.title")}</strong>
          <p className="text-sm text-stone-500">{t("admin.index.audit.desc")}</p>
        </Link>
        <Link
          to="/admin/reports"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>{t("admin.index.reports.title")}</strong>
          <p className="text-sm text-stone-500">{t("admin.index.reports.desc")}</p>
        </Link>
        <Link
          to="/admin/tables"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>{t("admin.index.tables.title")}</strong>
          <p className="text-sm text-stone-500">{t("admin.index.tables.desc")}</p>
        </Link>
      </ul>
    </section>
  );
}
