"use client";

import { can } from "./permissions";
import { useAuthStore } from "./store";

export function useSession() {
  return useAuthStore((state) => state.session);
}

/** True when the signed-in user holds the permission (UI only — the server re-checks). */
export function useCan(permission: string): boolean {
  return useAuthStore((state) => can(state.session, permission));
}
