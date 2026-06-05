/**
 * User-Management: Liste mit Filter (Name/Email-Search, Rolle, Status),
 * Inline-Aktionen Rolle wechseln + Block/Unblock.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { AdminUserView, Role, UserStatus } from "~/features/admin/types";
import { api, ApiError } from "~/lib/api";

export const Route = createFileRoute("/_auth/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | Role>("");
  const [statusFilter, setStatusFilter] = useState<"" | UserStatus>("");

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (roleFilter) params.set("role", roleFilter);
  if (statusFilter) params.set("status", statusFilter);
  params.set("limit", "100");

  const queryClient = useQueryClient();
  const queryKey = ["admin", "users", params.toString()] as const;
  const { data, isPending, error } = useQuery<{ users: AdminUserView[] }>({
    queryKey,
    queryFn: () => api(`/api/admin/users?${params.toString()}`),
  });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api(`/api/admin/users/${id}/role`, { method: "PATCH", body: { role } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      api(`/api/admin/users/${id}/status`, { method: "PATCH", body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("admin.users.searchPlaceholder")}
          className="rounded border border-stone-300 px-3 py-1.5 text-sm flex-1 min-w-[12rem]"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as Role | "")}
          className="rounded border border-stone-300 px-2 py-1.5 text-sm"
        >
          <option value="">{t("admin.users.allRoles")}</option>
          <option value="PLAYER">{t("admin.users.rolePlayer")}</option>
          <option value="MODERATOR">{t("admin.users.roleModerator")}</option>
          <option value="ADMIN">{t("admin.users.roleAdmin")}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as UserStatus | "")}
          className="rounded border border-stone-300 px-2 py-1.5 text-sm"
        >
          <option value="">{t("admin.users.allStatuses")}</option>
          <option value="ACTIVE">{t("admin.users.statusActive")}</option>
          <option value="BLOCKED">{t("admin.users.statusBlocked")}</option>
          <option value="DELETED_SOFT">{t("admin.users.statusDeletedSoft")}</option>
        </select>
      </header>

      {isPending && <p className="text-stone-500">{t("admin.users.loading")}</p>}
      {error && (
        <p role="alert" className="text-rose-700">
          {error.message}
        </p>
      )}

      {data && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-600">
              <th className="py-2 pr-3">{t("admin.users.colName")}</th>
              <th className="py-2 pr-3">{t("admin.users.colEmail")}</th>
              <th className="py-2 pr-3">{t("admin.users.colRole")}</th>
              <th className="py-2 pr-3">{t("admin.users.colStatus")}</th>
              <th className="py-2 pr-3">{t("admin.users.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="border-b border-stone-100">
                <td className="py-2 pr-3">{u.name}</td>
                <td className="py-2 pr-3 text-stone-600">{u.email}</td>
                <td className="py-2 pr-3">
                  <select
                    value={u.role}
                    onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as Role })}
                    disabled={setRole.isPending}
                    className="rounded border border-stone-300 px-2 py-0.5 text-xs"
                  >
                    <option value="PLAYER">{t("admin.users.rolePlayer")}</option>
                    <option value="MODERATOR">{t("admin.users.roleModerator")}</option>
                    <option value="ADMIN">{t("admin.users.roleAdmin")}</option>
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge status={u.status} />
                </td>
                <td className="py-2 pr-3">
                  {u.status === "ACTIVE" ? (
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: u.id, status: "BLOCKED" })}
                      disabled={setStatus.isPending}
                      className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-rose-50"
                    >
                      {t("admin.users.block")}
                    </button>
                  ) : u.status === "BLOCKED" ? (
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: u.id, status: "ACTIVE" })}
                      disabled={setStatus.isPending}
                      className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-emerald-50"
                    >
                      {t("admin.users.unblock")}
                    </button>
                  ) : (
                    <span className="text-xs text-stone-400">{t("admin.users.softDeleted")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {setRole.error instanceof ApiError && (
        <p role="alert" className="text-sm text-rose-700">
          {setRole.error.message}
        </p>
      )}
      {setStatus.error instanceof ApiError && (
        <p role="alert" className="text-sm text-rose-700">
          {setStatus.error.message}
        </p>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  const colors: Record<UserStatus, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-800",
    BLOCKED: "bg-rose-100 text-rose-800",
    DELETED_SOFT: "bg-stone-100 text-stone-600",
  };
  return <span className={`rounded px-1.5 py-0.5 text-xs ${colors[status]}`}>{status}</span>;
}
