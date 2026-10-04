/**
 * SMTP-Settings-Form. Liest aktuelle Settings, erlaubt das Patchen
 * einzelner Felder. Passwort wird beim Senden mit übertragen — aber
 * nie zurückgelesen (Server liefert nur `hasPassword`-Flag).
 *
 * Darunter „Testmail senden": schickt eine Testmail mit den GESPEICHERTEN
 * Settings an eine frei wählbare Adresse und zeigt das Ergebnis (bei Fehler
 * die Meldung des Mailservers). Solange das Formular ungespeicherte
 * Änderungen hat, ist der Test gesperrt — er würde sonst die alten Werte prüfen.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SmtpSettingsView, SmtpTestResult } from "~/features/admin/types";
import { api, ApiError } from "~/lib/api";
import { useSession } from "~/lib/auth-client";

export const Route = createFileRoute("/_auth/admin/smtp")({
  component: SmtpPage,
});

type TestOutcome = { ok: true; to: string } | { ok: false; error: string };

function SmtpPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { data, isPending } = useQuery<SmtpSettingsView>({
    queryKey: ["admin", "smtp"],
    queryFn: () => api<SmtpSettingsView>("/api/admin/smtp"),
  });

  const [host, setHost] = useState("");
  const [port, setPort] = useState<number | "">("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [noReply, setNoReply] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null);

  // Initial-Setzen, sobald data da ist.
  useEffect(() => {
    if (data) {
      setHost(data.host ?? "");
      setPort(data.port ?? "");
      setUser(data.user ?? "");
      setFrom(data.from ?? "");
      setNoReply(data.noReply ?? true);
    }
  }, [data]);

  // Testmail-Empfänger mit der eigenen Adresse vorbelegen (einmalig).
  const ownEmail = session?.user?.email;
  useEffect(() => {
    if (ownEmail) setTestTo((current) => current || ownEmail);
  }, [ownEmail]);

  const mut = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api("/api/admin/smtp", { method: "PUT", body: patch }),
    onSuccess: () => {
      setSuccess(t("admin.smtp.saveSuccess"));
      setError(null);
      setPassword("");
      queryClient.invalidateQueries({ queryKey: ["admin", "smtp"] });
      setTimeout(() => setSuccess(null), 5_000);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : t("admin.smtp.saveError"));
      setSuccess(null);
    },
  });

  const testMut = useMutation({
    mutationFn: (to: string) =>
      api<SmtpTestResult>("/api/admin/smtp/test", { method: "POST", body: { to } }),
    onMutate: () => setTestOutcome(null),
    onSuccess: (res, to) =>
      setTestOutcome(res.ok ? { ok: true, to } : { ok: false, error: res.error }),
    onError: (err: unknown) =>
      setTestOutcome({
        ok: false,
        error: err instanceof ApiError ? err.message : t("admin.smtp.testFailedGeneric"),
      }),
  });

  // Weicht das Formular von den gespeicherten Settings ab?
  const dirty =
    data !== undefined &&
    (host !== (data.host ?? "") ||
      port !== (data.port ?? "") ||
      user !== (data.user ?? "") ||
      from !== (data.from ?? "") ||
      noReply !== (data.noReply ?? true) ||
      password !== "");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    if (host.trim()) patch.host = host.trim();
    if (port !== "") patch.port = Number(port);
    // Empty string → null sendet (= aus DB löschen). Sonst weglassen (= unverändert).
    if (user.trim() !== (data?.user ?? "")) patch.user = user.trim() || null;
    if (from.trim()) patch.from = from.trim();
    if (password) patch.password = password;
    patch.noReply = noReply;
    mut.mutate(patch);
  }

  function onTestSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const to = testTo.trim();
    if (to) testMut.mutate(to);
  }

  if (isPending) return <p className="text-stone-500">{t("admin.smtp.loading")}</p>;

  return (
    <div className="space-y-8 max-w-xl">
      <form onSubmit={onSubmit} className="space-y-4">
        <h2 className="text-xl font-semibold">{t("admin.smtp.heading")}</h2>

        <FieldRow label={t("admin.smtp.hostLabel")}>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="smtp.example.com"
            className="w-full rounded border border-stone-300 px-3 py-2"
          />
        </FieldRow>

        <FieldRow label={t("admin.smtp.portLabel")}>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="587"
            min={1}
            max={65535}
            className="w-full rounded border border-stone-300 px-3 py-2"
          />
        </FieldRow>

        <FieldRow label={t("admin.smtp.userLabel")}>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder={t("admin.smtp.userPlaceholder")}
            className="w-full rounded border border-stone-300 px-3 py-2"
            autoComplete="off"
          />
        </FieldRow>

        <FieldRow
          label={
            data?.hasPassword ? t("admin.smtp.passwordLabelSet") : t("admin.smtp.passwordLabel")
          }
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={data?.hasPassword ? "••••••••" : t("admin.smtp.passwordLabel")}
            className="w-full rounded border border-stone-300 px-3 py-2"
            autoComplete="new-password"
          />
        </FieldRow>

        <FieldRow label={t("admin.smtp.fromLabel")}>
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="Heb ab! <noreply@example.com>"
            className="w-full rounded border border-stone-300 px-3 py-2"
          />
        </FieldRow>

        <label className="flex items-start gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={noReply}
            onChange={(e) => setNoReply(e.target.checked)}
            className="mt-1"
          />
          <span>
            {t("admin.smtp.noReplyLabel")}
            <span className="block text-xs text-stone-500">{t("admin.smtp.noReplyHelp")}</span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm text-emerald-700">
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={mut.isPending}
          className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {mut.isPending ? t("admin.smtp.saving") : t("admin.smtp.save")}
        </button>

        <p className="text-xs text-stone-500">{t("admin.smtp.hint")}</p>
      </form>

      <section
        aria-labelledby="smtp-test-heading"
        className="space-y-3 border-t border-stone-200 pt-6"
      >
        <h3 id="smtp-test-heading" className="text-lg font-semibold">
          {t("admin.smtp.testHeading")}
        </h3>
        <p className="text-sm text-stone-600">{t("admin.smtp.testIntro")}</p>
        <form onSubmit={onTestSubmit} className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[16rem] flex-1">
            <span className="mb-1 block text-sm font-medium text-stone-700">
              {t("admin.smtp.testToLabel")}
            </span>
            <input
              type="email"
              required
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="du@example.com"
              className="w-full rounded border border-stone-300 px-3 py-2"
              autoComplete="email"
            />
          </label>
          <button
            type="submit"
            disabled={testMut.isPending || dirty || !testTo.trim()}
            className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {testMut.isPending ? t("admin.smtp.testSending") : t("admin.smtp.testSubmit")}
          </button>
        </form>
        {dirty && <p className="text-xs text-amber-800">{t("admin.smtp.testUnsaved")}</p>}
        {testOutcome?.ok === true && (
          <p role="status" className="text-sm text-emerald-700">
            {t("admin.smtp.testSuccess", { to: testOutcome.to })}
          </p>
        )}
        {testOutcome?.ok === false && (
          <p role="alert" className="text-sm text-rose-700">
            {t("admin.smtp.testError", { error: testOutcome.error })}
          </p>
        )}
      </section>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
