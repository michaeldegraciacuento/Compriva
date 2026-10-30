"use client";

import { create } from "zustand";

import { ApiError, onUnauthenticated } from "@/lib/api";
import { getPlatform } from "@/platform";

import * as authApi from "./api";
import { offlineSignIn } from "./offline";
import type { AuthSessionResponse, Session } from "./types";

export type AuthStatus = "loading" | "guest" | "authenticated";

interface AuthState {
  status: AuthStatus;
  session: Session | null;

  bootstrap(): Promise<void>;
  /** Username or email + password, on the web and on the desktop. */
  login(login: string, password: string): Promise<void>;
  /** Desktop, without internet: username + PIN against the cashier list cached by sync. */
  loginWithPin(username: string, pin: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  /** Signs the UI out locally (session expired, revoked, ...). */
  clear(): void;
}

function toSession(response: AuthSessionResponse): Session {
  return {
    user: response.user,
    roles: response.user.roles.map((role) => role.name),
    permissions: response.permissions,
    mode: "online",
    method: response.auth.method,
    device: response.auth.device,
  };
}

let bootstrapping: Promise<void> | null = null;

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "loading",
  session: null,

  bootstrap() {
    bootstrapping ??= (async () => {
      const platform = await getPlatform();

      // Desktop: the token lives in memory, so after a restart the user signs in again.
      if (platform.terminal) {
        set({ status: "guest", session: null });
        return;
      }

      try {
        set({ status: "authenticated", session: toSession(await authApi.fetchMe()) });
      } catch {
        set({ status: "guest", session: null });
      }
    })().finally(() => {
      bootstrapping = null;
    });
    return bootstrapping;
  },

  async login(login, password) {
    const platform = await getPlatform();

    if (platform.terminal) {
      // The desktop app runs on another origin, so it receives a token instead of a cookie.
      const identity = await platform.getDeviceIdentity();
      const response = await authApi.tokenLogin(login, password, identity?.machineName ?? null);
      platform.terminal.setSessionToken(response.token ?? null);
      set({ status: "authenticated", session: toSession(response) });
      return;
    }

    set({ status: "authenticated", session: toSession(await authApi.webLogin(login, password)) });
  },

  async loginWithPin(username, pin) {
    const platform = await getPlatform();
    const db = await platform.getLocalDatabase();
    if (!db || !platform.terminal) throw new Error("PIN sign-in is only available at desktop terminals.");
    const terminal = platform.terminal;
    const session = await offlineSignIn(db, (value, hash) => terminal.verifyPin(value, hash), username, pin);
    terminal.setSessionToken(null);
    set({ status: "authenticated", session });
  },

  async logout() {
    const platform = await getPlatform();
    try {
      if (get().session?.mode !== "offline") await authApi.logout();
    } catch (error) {
      // Already signed out on the server, or offline: sign out locally anyway.
      if (!(error instanceof ApiError)) throw error;
    }
    platform.terminal?.setSessionToken(null);
    get().clear();
  },

  async refresh() {
    if (get().status !== "authenticated") return;
    set({ session: toSession(await authApi.fetchMe()) });
  },

  clear() {
    void getPlatform().then((platform) => platform.terminal?.setSessionToken(null));
    set({ status: "guest", session: null });
  },
}));

// Any 401 from the API (expired session, revoked token, suspended account) signs the UI out.
// Not an offline PIN session: it has no server session to expire, and its API calls are expected to fail.
if (typeof window !== "undefined") {
  onUnauthenticated(() => {
    const { status, session } = useAuthStore.getState();
    if (status === "authenticated" && session?.mode !== "offline") useAuthStore.getState().clear();
  });
}
