import { getApiClient } from "@/lib/api";
import type { Paginated, PaginationMeta } from "@/types/api";

import type { ManagedUser, Permission, Role, RoleOption, UserMeta } from "./types";

async function writer() {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return api;
}

export interface UserFilters {
  q?: string;
  status?: "active" | "suspended";
  role?: string;
  page?: number;
}

export async function fetchUsers(filters: UserFilters): Promise<Paginated<ManagedUser>> {
  return (await getApiClient()).request<ManagedUser[], PaginationMeta>("GET", "/users", undefined, { params: filters });
}

export async function fetchUser(id: string): Promise<{ user: ManagedUser; meta: UserMeta }> {
  const response = await (await getApiClient()).request<ManagedUser, UserMeta>("GET", `/users/${id}`);
  return { user: response.data, meta: response.meta as UserMeta };
}

export const fetchRoleOptions = async () => (await getApiClient()).get<RoleOption[]>("/users/role-options");

export interface NewUserInput {
  name: string;
  username: string;
  email: string | null;
  password: string;
  password_confirmation: string;
  pin: string | null;
  roles: string[];
}

export const createUser = async (input: NewUserInput) => (await writer()).post<ManagedUser>("/users", input);
export const updateUser = async (id: string, input: { name?: string; username?: string; email?: string | null }) => (await writer()).patch<ManagedUser>(`/users/${id}`, input);
export const setUserRoles = async (id: string, roles: string[]) => (await writer()).put<ManagedUser>(`/users/${id}/roles`, { roles });
export const suspendUser = async (id: string, reason?: string) => (await writer()).post<ManagedUser>(`/users/${id}/suspend`, { reason: reason || null });
export const activateUser = async (id: string) => (await writer()).post<ManagedUser>(`/users/${id}/activate`);
export const resetCredentials = async (id: string, input: { password?: string; password_confirmation?: string; pin?: string | null }) =>
  (await writer()).put<void>(`/users/${id}/credentials`, input);
export const revokeAccess = async (id: string) => (await writer()).delete<void>(`/users/${id}/access`);

export const fetchRoles = async () => (await getApiClient()).get<Role[]>("/roles");
export const fetchRole = async (id: string) => (await getApiClient()).get<Role>(`/roles/${id}`);
export const fetchPermissions = async () => (await getApiClient()).get<Permission[]>("/permissions");
export const createRole = async (input: { name: string; display_name: string; description: string | null; permissions: string[] }) => (await writer()).post<Role>("/roles", input);
export const updateRole = async (id: string, input: { display_name: string; description: string | null }) => (await writer()).patch<Role>(`/roles/${id}`, input);
export const setRolePermissions = async (id: string, permissions: string[]) => (await writer()).put<Role>(`/roles/${id}/permissions`, { permissions });
export const deleteRole = async (id: string) => (await writer()).delete<void>(`/roles/${id}`);
