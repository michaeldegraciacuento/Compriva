import type { LocalDatabase, SqlStatement } from "@/platform/types";

import type { CashierSnapshot, Session } from "./types";

/**
 * Offline cashier sign-in for desktop terminals (docs/authentication.md §4).
 *
 * The terminal caches the server's cashier snapshot (bcrypt PIN hashes,
 * permissions) in SQLite. Offline, a PIN is verified against the cached hash
 * in native code. Protections:
 * - the snapshot expires (valid_until); an expired cache never signs anyone in
 * - 5 wrong PINs lock the username for 5 minutes, doubling up to 1 hour
 * - every failure returns the same message
 */

export const MAX_ATTEMPTS = 5;
export const BASE_LOCKOUT_MS = 5 * 60_000;
export const MAX_LOCKOUT_MS = 60 * 60_000;
const VALID_UNTIL_KEY = "cashiers.valid_until";

export const OFFLINE_FAILURE_MESSAGE = "The username or PIN is incorrect, or this account cannot use the POS.";

export class OfflineAuthError extends Error {
  constructor(
    readonly reason: "invalid" | "locked" | "no_cache" | "expired",
    message: string,
    readonly lockedUntil: Date | null = null,
  ) {
    super(message);
    this.name = "OfflineAuthError";
  }
}

interface CashierRow {
  id: string;
  name: string;
  username: string;
  pin_hash: string;
  roles: string;
  permissions: string;
}

interface LockoutRow {
  failed_attempts: number;
  locked_until: string | null;
}

/**
 * Statements that replace the cached cashier list with the server snapshot.
 * Ordered so that even when run one by one an interruption can only leave
 * FEWER cashiers able to sign in: removed users are deleted first, the new
 * expiry is written last. The sync engine runs them in one transaction.
 */
export function cashierSnapshotStatements(snapshot: CashierSnapshot, now = new Date()): SqlStatement[] {
  const syncedAt = now.toISOString();
  const ids = snapshot.cashiers.map((c) => c.id);
  const statements: SqlStatement[] = [
    ids.length === 0
      ? { sql: "DELETE FROM cashiers" }
      : { sql: `DELETE FROM cashiers WHERE id NOT IN (${ids.map((_, i) => `$${i + 1}`).join(", ")})`, params: ids },
  ];

  for (let start = 0; start < snapshot.cashiers.length; start += 50) {
    const chunk = snapshot.cashiers.slice(start, start + 50);
    const params: unknown[] = [];
    const rows = chunk.map((c) => {
      const base = params.length;
      params.push(c.id, c.name, c.username.toLowerCase(), c.pin_hash, JSON.stringify(c.roles), JSON.stringify(c.permissions), c.updated_at, syncedAt);
      return `(${Array.from({ length: 8 }, (_, i) => `$${base + i + 1}`).join(", ")})`;
    });
    statements.push({
      sql: `INSERT INTO cashiers (id, name, username, pin_hash, roles, permissions, updated_at, synced_at) VALUES ${rows.join(", ")}
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, username = excluded.username, pin_hash = excluded.pin_hash,
         roles = excluded.roles, permissions = excluded.permissions, updated_at = excluded.updated_at, synced_at = excluded.synced_at`,
      params,
    });
  }

  statements.push({
    sql: "INSERT INTO local_meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    params: [VALID_UNTIL_KEY, snapshot.valid_until],
  });
  return statements;
}

/** Replaces the cached cashier list, statement by statement (see cashierSnapshotStatements). */
export async function storeCashierSnapshot(db: LocalDatabase, snapshot: CashierSnapshot, now = new Date()): Promise<void> {
  for (const statement of cashierSnapshotStatements(snapshot, now)) {
    await db.execute(statement.sql, statement.params);
  }
}

export function lockoutDuration(failedAttempts: number): number {
  const lockouts = Math.floor(failedAttempts / MAX_ATTEMPTS);
  return Math.min(BASE_LOCKOUT_MS * 2 ** Math.max(0, lockouts - 1), MAX_LOCKOUT_MS);
}

export async function offlineSignIn(
  db: LocalDatabase,
  verifyPin: (pin: string, hash: string) => Promise<boolean>,
  usernameInput: string,
  pin: string,
  now = new Date(),
): Promise<Session> {
  const username = usernameInput.trim().toLowerCase();

  const [validUntil] = await db.select<{ value: string }>("SELECT value FROM local_meta WHERE key = $1", [VALID_UNTIL_KEY]);
  if (!validUntil) {
    throw new OfflineAuthError("no_cache", "This terminal has not downloaded the cashier list yet. Connect to the internet to sign in.");
  }
  if (new Date(validUntil.value) <= now) {
    throw new OfflineAuthError("expired", "The offline cashier list has expired. Connect to the internet to sign in.");
  }

  const [lockout] = await db.select<LockoutRow>("SELECT failed_attempts, locked_until FROM auth_lockouts WHERE username = $1", [username]);
  if (lockout?.locked_until && new Date(lockout.locked_until) > now) {
    const until = new Date(lockout.locked_until);
    throw new OfflineAuthError("locked", `Too many wrong PINs. Try again after ${until.toLocaleTimeString()}.`, until);
  }

  const [cashier] = await db.select<CashierRow>("SELECT * FROM cashiers WHERE username = $1", [username]);
  // Always run one bcrypt verification so timing does not reveal unknown usernames.
  const valid = await verifyPin(pin, cashier?.pin_hash ?? "$2y$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid");
  const permissions: string[] = cashier ? JSON.parse(cashier.permissions) : [];

  if (!cashier || !valid || !permissions.includes("pos.access")) {
    const attempts = (lockout?.failed_attempts ?? 0) + 1;
    const lockedUntil = attempts % MAX_ATTEMPTS === 0 ? new Date(now.getTime() + lockoutDuration(attempts)).toISOString() : null;
    await db.execute(
      "INSERT INTO auth_lockouts (username, failed_attempts, locked_until) VALUES ($1, $2, $3) ON CONFLICT(username) DO UPDATE SET failed_attempts = excluded.failed_attempts, locked_until = excluded.locked_until",
      [username, attempts, lockedUntil],
    );
    throw new OfflineAuthError("invalid", OFFLINE_FAILURE_MESSAGE);
  }

  await db.execute("DELETE FROM auth_lockouts WHERE username = $1", [username]);

  return {
    user: { id: cashier.id, name: cashier.name, username: cashier.username },
    roles: JSON.parse(cashier.roles),
    permissions,
    mode: "offline",
    method: "offline-pin",
    device: null,
  };
}
