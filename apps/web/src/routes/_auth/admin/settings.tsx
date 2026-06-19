/**
 * Globale Lobby-Einstellungen — Admin-Tab.
 *
 *   - max. gleichzeitig aktive Tische (WAITING + IN_GAME + POST_GAME)
 *   - max. Sitze pro Variante (Hard-Cap, heute > 6 wäre sinnlos)
 *   - Default-Punkte-Ziel (Fallback wenn der Eröffner kein eigenes mitschickt)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "~/lib/api";

interface LobbySettings {
  maxOpenTables: number;
  maxSeatsPerTable: number;
  defaultPointsTarget: number;
}

interface NameCooldowns {
  changeHours: number;
  releaseHours: number;
}

export const Route = createFileRoute("/_auth/admin/settings")({
  component: GlobalSettingsPage,
});

function GlobalSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["admin", "lobby-settings"] as const;
  const { data, isPending } = useQuery<LobbySettings>({
    queryKey,
    queryFn: () => api("/api/admin/lobby-settings"),
  });

  const [draft, setDraft] = useState<LobbySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Sync server-state in den Editor, sobald Daten ankommen oder sich der
  // Server-State ändert (z.B. nach erfolgreichem Speichern).
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (payload: LobbySettings) =>
      api<LobbySettings>("/api/admin/lobby-settings", {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (fresh) => {
      setError(null);
      setSavedAt(Date.now());
      queryClient.setQueryData(queryKey, fresh);
      setDraft(fresh);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : t("admin.settings.saveError"));
    },
  });

  if (isPending || !draft) {
    return <p className="text-stone-500">{t("admin.settings.loading")}</p>;
  }

  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    saveMut.mutate(draft);
  }

  function setField<K extends keyof LobbySettings>(field: K, value: number): void {
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  return (
    <div className="max-w-xl space-y-8">
      <section className="space-y-4">
        <p className="text-sm text-stone-600">{t("admin.settings.intro")}</p>

        <form onSubmit={onSave} className="space-y-4">
          <NumberRow
            label={t("admin.settings.maxOpenTablesLabel")}
            help={t("admin.settings.maxOpenTablesHelp")}
            value={draft.maxOpenTables}
            min={1}
            max={10_000}
            onChange={(v) => setField("maxOpenTables", v)}
          />
          <NumberRow
            label={t("admin.settings.maxSeatsLabel")}
            help={t("admin.settings.maxSeatsHelp")}
            value={draft.maxSeatsPerTable}
            min={2}
            max={12}
            onChange={(v) => setField("maxSeatsPerTable", v)}
          />
          <NumberRow
            label={t("admin.settings.defaultPointsLabel")}
            help={t("admin.settings.defaultPointsHelp")}
            value={draft.defaultPointsTarget}
            min={500}
            max={5000}
            onChange={(v) => setField("defaultPointsTarget", v)}
          />

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saveMut.isPending}
              className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
            >
              {t("admin.settings.save")}
            </button>
            {savedAt !== null && Date.now() - savedAt < 5_000 && (
              <span className="text-sm text-emerald-700">{t("admin.settings.saved")}</span>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          )}
        </form>
      </section>

      <NameCooldownsSection />
    </div>
  );
}

/**
 * Spielernamen-Cooldowns — eigener Server-State (AdminSetting-Keys
 * `users.nameChangeCooldownHours` / `users.nameReleaseCooldownHours`).
 * 0 Stunden = Cooldown aus.
 */
function NameCooldownsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["admin", "name-cooldowns"] as const;
  const { data, isPending } = useQuery<NameCooldowns>({
    queryKey,
    queryFn: () => api("/api/admin/name-cooldowns"),
  });

  const [draft, setDraft] = useState<NameCooldowns | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (payload: NameCooldowns) =>
      api<NameCooldowns>("/api/admin/name-cooldowns", { method: "PUT", body: payload }),
    onSuccess: (fresh) => {
      setError(null);
      setSavedAt(Date.now());
      queryClient.setQueryData(queryKey, fresh);
      setDraft(fresh);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : t("admin.settings.saveError"));
    },
  });

  if (isPending || !draft) return null;

  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    saveMut.mutate(draft);
  }

  function setField<K extends keyof NameCooldowns>(field: K, value: number): void {
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold">{t("admin.settings.nameCooldowns.title")}</h2>
        <p className="text-sm text-stone-600">{t("admin.settings.nameCooldowns.intro")}</p>
      </div>

      <form onSubmit={onSave} className="space-y-4">
        <NumberRow
          label={t("admin.settings.nameCooldowns.changeLabel")}
          help={t("admin.settings.nameCooldowns.changeHelp")}
          value={draft.changeHours}
          min={0}
          max={8760}
          onChange={(v) => setField("changeHours", v)}
        />
        <NumberRow
          label={t("admin.settings.nameCooldowns.releaseLabel")}
          help={t("admin.settings.nameCooldowns.releaseHelp")}
          value={draft.releaseHours}
          min={0}
          max={8760}
          onChange={(v) => setField("releaseHours", v)}
        />

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saveMut.isPending}
            className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {t("admin.settings.save")}
          </button>
          {savedAt !== null && Date.now() - savedAt < 5_000 && (
            <span className="text-sm text-emerald-700">{t("admin.settings.saved")}</span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

interface NumberRowProps {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function NumberRow({ label, help, value, min, max, onChange }: NumberRowProps) {
  return (
    <label className="block">
      <span className="block font-medium">{label}</span>
      <span className="block text-xs text-stone-500 mb-1">{help}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-32 rounded border border-stone-300 px-3 py-2"
        required
      />
    </label>
  );
}
