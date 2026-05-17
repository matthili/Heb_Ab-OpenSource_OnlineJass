/**
 * SMTP-Settings-Form. Liest aktuelle Settings, erlaubt das Patchen
 * einzelner Felder. Passwort wird beim Senden mit übertragen — aber
 * nie zurückgelesen (Server liefert nur `hasPassword`-Flag).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";

import type { SmtpSettingsView } from "~/features/admin/types";
import { api, ApiError } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/smtp")({
  component: SmtpPage,
});

function SmtpPage() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery<SmtpSettingsView>({
    queryKey: ["admin", "smtp"],
    queryFn: () => api<SmtpSettingsView>("/api/admin/smtp"),
  });

  const [host, setHost] = useState("");
  const [port, setPort] = useState<number | "">("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Initial-Setzen, sobald data da ist.
  useEffect(() => {
    if (data) {
      setHost(data.host ?? "");
      setPort(data.port ?? "");
      setUser(data.user ?? "");
      setFrom(data.from ?? "");
    }
  }, [data]);

  const mut = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api("/api/admin/smtp", { method: "PUT", body: patch }),
    onSuccess: () => {
      setSuccess("Gespeichert. Der nächste Mail-Versand nutzt die neuen Settings.");
      setError(null);
      setPassword("");
      queryClient.invalidateQueries({ queryKey: ["admin", "smtp"] });
      setTimeout(() => setSuccess(null), 5_000);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Speichern fehlgeschlagen.");
      setSuccess(null);
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    if (host.trim()) patch.host = host.trim();
    if (port !== "") patch.port = Number(port);
    // Empty string → null sendet (= aus DB löschen). Sonst weglassen (= unverändert).
    if (user.trim() !== (data?.user ?? "")) patch.user = user.trim() || null;
    if (from.trim()) patch.from = from.trim();
    if (password) patch.password = password;
    mut.mutate(patch);
  }

  if (isPending) return <p className="text-stone-500">Lade Settings …</p>;

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-xl">
      <h2 className="text-xl font-semibold">SMTP-Settings</h2>

      <FieldRow label="Host">
        <input
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="smtp.example.com"
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
      </FieldRow>

      <FieldRow label="Port">
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

      <FieldRow label="User (optional)">
        <input
          type="text"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="leer = ohne Auth"
          className="w-full rounded border border-stone-300 px-3 py-2"
          autoComplete="off"
        />
      </FieldRow>

      <FieldRow label={data?.hasPassword ? "Passwort (gesetzt; leer = unverändert)" : "Passwort"}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={data?.hasPassword ? "••••••••" : "Passwort"}
          className="w-full rounded border border-stone-300 px-3 py-2"
          autoComplete="new-password"
        />
      </FieldRow>

      <FieldRow label="Absender (From-Header)">
        <input
          type="text"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="Heb ab! <noreply@example.com>"
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
      </FieldRow>

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
        {mut.isPending ? "Speichere …" : "Settings speichern"}
      </button>

      <p className="text-xs text-stone-500">
        Hinweis: Der nächste Mail-Versand (Verify, Reset, …) baut den SMTP-Transporter automatisch
        neu. Du kannst die neuen Settings sofort verifizieren, indem du z.B. ein Passwort-Reset für
        einen Test-User auslöst.
      </p>
    </form>
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
