import type { Capabilities } from "./session";
import { requestJson } from "./request";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  banned: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  capabilities: Capabilities;
}

export interface UserListResponse {
  users: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}

export function listUsers(search: string) {
  const params = new URLSearchParams({ limit: "100" });
  if (search.trim()) params.set("search", search.trim());

  return requestJson<UserListResponse>(`/admin/users?${params.toString()}`);
}

export function createUser(input: {
  email: string;
  name: string;
  capabilities: Capabilities;
}) {
  return requestJson<{ user: AdminUser; password: string }>("/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resetPassword(id: string) {
  return requestJson<{ password: string }>(
    `/admin/users/${id}/reset-password`,
    { method: "POST" },
  );
}

export function updateCapabilities(id: string, capabilities: Capabilities) {
  return requestJson<{ capabilities: Capabilities }>(
    `/admin/users/${id}/capabilities`,
    {
      method: "PATCH",
      body: JSON.stringify({ capabilities }),
    },
  );
}

export function setBanned(id: string, banned: boolean) {
  return requestJson<{ banned: boolean }>(
    `/admin/users/${id}/${banned ? "ban" : "unban"}`,
    { method: "POST" },
  );
}

export function deleteUser(id: string) {
  return requestJson<{ deleted: boolean }>(`/admin/users/${id}`, {
    method: "DELETE",
  });
}
