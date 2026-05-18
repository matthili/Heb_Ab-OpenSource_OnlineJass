/**
 * „Profil bearbeiten"-Tab.
 *
 * Vier-Stufen-Sichtbarkeit pro Feld (siehe `apps/api/src/modules/users/
 * visibility.ts`). Jedes editierbare Feld bekommt rechts ein
 * Sichtbarkeits-Dropdown — der Server speichert beides in einer
 * einzigen `PATCH /api/users/me`-Anfrage.
 *
 * **Was hier NICHT geht** (mit Absicht):
 *   - E-Mail-Wechsel: Better Auth `/api/auth/change-email` (mit Verify-Mail).
 *   - Spielername (`name`) ändern: Better Auth `/api/auth/update-user`
 *     (prüft Unique-Constraint).
 *   - Account löschen / Datenexport: separater „Meine Daten"-Tab.
 *
 * Visibility-Defaults stehen serverseitig in `DEFAULT_VISIBILITY` und
 * werden vom GET /api/users/me bereits resolved geliefert — der Client
 * sieht also pro Feld eine konkrete Stufe, nie `undefined`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "~/lib/api";

const VISIBILITY_LEVELS = ["PUBLIC", "LOGGED_IN", "FRIENDS", "PRIVATE"] as const;
type VisibilityLevel = (typeof VISIBILITY_LEVELS)[number];

type FieldName =
  | "realFirstName"
  | "realLastName"
  | "birthDate"
  | "city"
  | "country"
  | "hobbies"
  | "bio"
  | "avatarUrl";

interface MyProfileView {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  role: string;
  status: string;
  locale: string;
  createdAt: string;
  profile: {
    realFirstName: string | null;
    realLastName: string | null;
    birthDate: string | null; // ISO date
    city: string | null;
    country: string | null;
    hobbies: string | null;
    bio: string | null;
    avatarUrl: string | null;
    visibility: Record<FieldName, VisibilityLevel>;
  };
}

interface FormState {
  realFirstName: string;
  realLastName: string;
  birthDate: string; // YYYY-MM-DD
  city: string;
  country: string;
  hobbies: string;
  bio: string;
  avatarUrl: string;
  visibility: Record<FieldName, VisibilityLevel>;
}

const EMPTY_VISIBILITY: Record<FieldName, VisibilityLevel> = {
  realFirstName: "LOGGED_IN",
  realLastName: "LOGGED_IN",
  birthDate: "LOGGED_IN",
  city: "LOGGED_IN",
  country: "LOGGED_IN",
  hobbies: "LOGGED_IN",
  bio: "PUBLIC",
  avatarUrl: "PUBLIC",
};

export function ProfileEditPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["users", "me"] as const;

  const { data, isPending, error } = useQuery<MyProfileView>({
    queryKey,
    queryFn: () => api<MyProfileView>("/api/users/me"),
  });

  const initial = useMemo<FormState>(() => {
    if (!data) {
      return {
        realFirstName: "",
        realLastName: "",
        birthDate: "",
        city: "",
        country: "",
        hobbies: "",
        bio: "",
        avatarUrl: "",
        visibility: { ...EMPTY_VISIBILITY },
      };
    }
    const p = data.profile;
    return {
      realFirstName: p.realFirstName ?? "",
      realLastName: p.realLastName ?? "",
      birthDate: p.birthDate ? p.birthDate.slice(0, 10) : "",
      city: p.city ?? "",
      country: p.country ?? "",
      hobbies: p.hobbies ?? "",
      bio: p.bio ?? "",
      avatarUrl: p.avatarUrl ?? "",
      visibility: { ...p.visibility },
    };
  }, [data]);

  const [form, setForm] = useState<FormState>(initial);
  const [savedFlash, setSavedFlash] = useState(false);

  // Wenn die Query frisch lädt (z.B. nach Invalidate), Form-State neu
  // initialisieren — sonst überschreibt der lokale State den frischen
  // Server-Wert.
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const saveMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<MyProfileView>("/api/users/me", { method: "PATCH", body: payload }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKey, fresh);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  function setVisibility(field: FieldName, level: VisibilityLevel) {
    setForm((s) => ({ ...s, visibility: { ...s.visibility, [field]: level } }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Leere Strings → null mappen, damit der Server das Feld räumt.
    const trimmedOrNull = (s: string): string | null => {
      const t = s.trim();
      return t.length === 0 ? null : t;
    };
    saveMut.mutate({
      realFirstName: trimmedOrNull(form.realFirstName),
      realLastName: trimmedOrNull(form.realLastName),
      birthDate: form.birthDate || null,
      city: trimmedOrNull(form.city),
      country: trimmedOrNull(form.country),
      hobbies: trimmedOrNull(form.hobbies),
      bio: trimmedOrNull(form.bio),
      avatarUrl: trimmedOrNull(form.avatarUrl),
      visibility: form.visibility,
    });
  }

  if (isPending) return <p className="text-stone-500">…</p>;
  if (error) {
    return (
      <p role="alert" className="text-rose-700">
        {(error as Error).message}
      </p>
    );
  }
  if (!data) return null;

  const errMsg = saveMut.error instanceof ApiError ? saveMut.error.message : null;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t("profile.edit.title")}</h2>
        <p className="text-sm text-stone-600">{t("profile.edit.intro")}</p>
        <p className="text-xs text-stone-500">
          {t("profile.edit.realFirstName")}, {t("profile.edit.realLastName")} &amp; Co. sind alle
          freiwillig — Spielername ({data.name}) und E-Mail ({data.email}) änderst du über die
          Konto-Verwaltung.
        </p>
      </header>

      <FieldRow
        label={t("profile.edit.realFirstName")}
        field="realFirstName"
        visibility={form.visibility}
        onVisibility={setVisibility}
      >
        <input
          type="text"
          value={form.realFirstName}
          onChange={(e) => setField("realFirstName", e.currentTarget.value)}
          maxLength={80}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
        />
      </FieldRow>

      <FieldRow
        label={t("profile.edit.realLastName")}
        field="realLastName"
        visibility={form.visibility}
        onVisibility={setVisibility}
      >
        <input
          type="text"
          value={form.realLastName}
          onChange={(e) => setField("realLastName", e.currentTarget.value)}
          maxLength={80}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
        />
      </FieldRow>

      <FieldRow
        label={t("profile.edit.birthDate")}
        field="birthDate"
        visibility={form.visibility}
        onVisibility={setVisibility}
      >
        <input
          type="date"
          value={form.birthDate}
          onChange={(e) => setField("birthDate", e.currentTarget.value)}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
        />
      </FieldRow>

      <FieldRow
        label={t("profile.edit.city")}
        field="city"
        visibility={form.visibility}
        onVisibility={setVisibility}
      >
        <input
          type="text"
          value={form.city}
          onChange={(e) => setField("city", e.currentTarget.value)}
          maxLength={120}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
        />
      </FieldRow>

      <FieldRow
        label={t("profile.edit.country")}
        field="country"
        visibility={form.visibility}
        onVisibility={setVisibility}
      >
        <input
          type="text"
          value={form.country}
          onChange={(e) => setField("country", e.currentTarget.value)}
          maxLength={80}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
        />
      </FieldRow>

      <FieldRow
        label={t("profile.edit.hobbies")}
        field="hobbies"
        visibility={form.visibility}
        onVisibility={setVisibility}
      >
        <textarea
          value={form.hobbies}
          onChange={(e) => setField("hobbies", e.currentTarget.value)}
          maxLength={1000}
          rows={2}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
        />
      </FieldRow>

      <FieldRow
        label={t("profile.edit.bio")}
        field="bio"
        visibility={form.visibility}
        onVisibility={setVisibility}
      >
        <textarea
          value={form.bio}
          onChange={(e) => setField("bio", e.currentTarget.value)}
          maxLength={2000}
          rows={4}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
        />
      </FieldRow>

      <FieldRow
        label={t("profile.edit.avatarUrl")}
        field="avatarUrl"
        visibility={form.visibility}
        onVisibility={setVisibility}
      >
        <input
          type="url"
          value={form.avatarUrl}
          onChange={(e) => setField("avatarUrl", e.currentTarget.value)}
          maxLength={2000}
          placeholder="https://…"
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
        />
      </FieldRow>

      {errMsg && (
        <p role="alert" className="text-sm text-rose-700">
          {t("profile.edit.saveError", { message: errMsg })}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saveMut.isPending} className="btn-jass-primary">
          {saveMut.isPending ? t("profile.edit.saving") : t("profile.edit.save")}
        </button>
        {savedFlash && (
          <span className="text-sm text-emerald-700" role="status">
            {t("profile.edit.saved")}
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * Ein editierbares Feld mit Label, Eingabe-Slot und Sichtbarkeits-Dropdown.
 * Layout: Label oben, Eingabe links, Sichtbarkeits-Selector rechts daneben.
 */
function FieldRow({
  label,
  field,
  visibility,
  onVisibility,
  children,
}: {
  label: string;
  field: FieldName;
  visibility: Record<FieldName, VisibilityLevel>;
  onVisibility: (field: FieldName, level: VisibilityLevel) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_14rem] gap-2 sm:gap-3 items-start">
      <label className="block space-y-1">
        <span className="block text-sm font-medium text-stone-700">{label}</span>
        {children}
      </label>
      <label className="block space-y-1">
        <span className="block text-xs text-stone-500">{t("profile.edit.visibility.label")}</span>
        <select
          value={visibility[field]}
          onChange={(e) => onVisibility(field, e.currentTarget.value as VisibilityLevel)}
          className="w-full rounded border border-stone-300 px-2 py-1 text-sm bg-white"
        >
          {VISIBILITY_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {t(`profile.edit.visibility.${lvl}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
