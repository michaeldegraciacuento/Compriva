import type { Session } from "./types";

/**
 * UI-side permission checks. These only decide what to SHOW; the API checks
 * every permission again on the server (docs/authentication.md §5).
 */
export function can(session: Session | null, permission: string): boolean {
  return session?.permissions.includes(permission) ?? false;
}

export function canAny(session: Session | null, permissions: readonly string[]): boolean {
  return permissions.some((permission) => can(session, permission));
}
