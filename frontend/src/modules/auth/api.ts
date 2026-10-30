import { getApiClient } from "@/lib/api";

import type { AuthSessionResponse } from "./types";

/** Web: cookie session. Fetches the CSRF cookie first (Sanctum SPA flow). */
export async function webLogin(login: string, password: string): Promise<AuthSessionResponse> {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return api.post<AuthSessionResponse>("/auth/login", { login, password });
}

export async function fetchMe(): Promise<AuthSessionResponse> {
  const api = await getApiClient();
  return api.get<AuthSessionResponse>("/auth/me");
}

export async function logout(): Promise<void> {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  await api.post<void>("/auth/logout");
}

export async function updateProfile(input: { name: string; email: string | null }): Promise<AuthSessionResponse> {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return api.patch<AuthSessionResponse>("/auth/profile", input);
}

export async function changePassword(input: {
  current_password: string;
  password: string;
  password_confirmation: string;
}): Promise<void> {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  await api.put<void>("/auth/password", input);
}

export async function changePin(input: { current_password: string; pin: string; pin_confirmation: string }): Promise<void> {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  await api.put<void>("/auth/pin", input);
}

// --- Desktop app ---------------------------------------------------------------

/** Desktop: same username/email + password; the desktop app receives a token instead of a cookie. */
export async function tokenLogin(login: string, password: string, deviceName: string | null): Promise<AuthSessionResponse> {
  const api = await getApiClient();
  return api.post<AuthSessionResponse>("/auth/token", { login, password, device_name: deviceName });
}
