// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalDatabase } from "@/platform/types";

import { createTestDatabase } from "../offline/testing/node-database";
import { MAX_ATTEMPTS, OFFLINE_FAILURE_MESSAGE, OfflineAuthError, offlineSignIn, storeCashierSnapshot } from "./offline";
import type { CashierSnapshot } from "./types";

/** The terminal's real schema: the migration files the desktop app ships (src-tauri/migrations). */
function terminalDatabase(): LocalDatabase {
  return createTestDatabase();
}

const NOW = new Date("2026-10-31T02:00:00Z");

function snapshot(overrides: Partial<CashierSnapshot> = {}): CashierSnapshot {
  return {
    cashiers: [
      { id: "u-juan", name: "Juan Dela Cruz", username: "Juan", pin_hash: "hash:482916", roles: ["cashier"], permissions: ["pos.access", "sales.reprint"], updated_at: null },
      { id: "u-ana", name: "Ana Reyes", username: "ana", pin_hash: "hash:739215", roles: ["cashier"], permissions: ["pos.access"], updated_at: null },
    ],
    generated_at: "2026-10-31T00:00:00Z",
    valid_until: "2026-11-03T00:00:00Z",
    ...overrides,
  };
}

/** Stand-in for the native bcrypt verifier. */
const verifyPin = vi.fn(async (pin: string, hash: string) => hash === `hash:${pin}`);

describe("offline cashier sign-in", () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    verifyPin.mockClear();
    db = terminalDatabase();
  });

  it("signs in with a cached PIN, case-insensitive username", async () => {
    await storeCashierSnapshot(db, snapshot(), NOW);

    const session = await offlineSignIn(db, verifyPin, " JUAN ", "482916", NOW);

    expect(session).toMatchObject({
      user: { id: "u-juan", name: "Juan Dela Cruz", username: "juan" },
      roles: ["cashier"],
      permissions: ["pos.access", "sales.reprint"],
      mode: "offline",
      method: "offline-pin",
    });
  });

  it("refuses when nothing has been cached or the cache expired", async () => {
    await expect(offlineSignIn(db, verifyPin, "juan", "482916", NOW)).rejects.toMatchObject({ reason: "no_cache" });

    await storeCashierSnapshot(db, snapshot({ valid_until: "2026-10-31T01:59:59Z" }), NOW);
    await expect(offlineSignIn(db, verifyPin, "juan", "482916", NOW)).rejects.toMatchObject({ reason: "expired" });
  });

  it("gives one message for wrong PINs and unknown users, and still runs bcrypt", async () => {
    await storeCashierSnapshot(db, snapshot(), NOW);

    const wrong = offlineSignIn(db, verifyPin, "juan", "000000", NOW);
    const unknown = offlineSignIn(db, verifyPin, "nobody", "482916", NOW);

    await expect(wrong).rejects.toThrow(OFFLINE_FAILURE_MESSAGE);
    await expect(unknown).rejects.toThrow(OFFLINE_FAILURE_MESSAGE);
    expect(verifyPin).toHaveBeenCalledTimes(2);
  });

  it("locks a username after 5 wrong PINs, even for the correct PIN, then unlocks", async () => {
    await storeCashierSnapshot(db, snapshot(), NOW);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await expect(offlineSignIn(db, verifyPin, "juan", "000000", NOW)).rejects.toMatchObject({ reason: "invalid" });
    }

    const locked = await offlineSignIn(db, verifyPin, "juan", "482916", NOW).catch((e: OfflineAuthError) => e);
    expect(locked).toBeInstanceOf(OfflineAuthError);
    expect((locked as OfflineAuthError).reason).toBe("locked");
    expect((locked as OfflineAuthError).lockedUntil).toEqual(new Date(NOW.getTime() + 5 * 60_000));

    // Other cashiers are unaffected; after the lockout the correct PIN works and resets the counter.
    await expect(offlineSignIn(db, verifyPin, "ana", "739215", NOW)).resolves.toMatchObject({ user: { id: "u-ana" } });
    const later = new Date(NOW.getTime() + 5 * 60_000 + 1);
    await expect(offlineSignIn(db, verifyPin, "juan", "482916", later)).resolves.toMatchObject({ user: { id: "u-juan" } });
    expect(await db.select("SELECT * FROM auth_lockouts WHERE username = $1", ["juan"])).toHaveLength(0);
  });

  it("doubles the lockout for repeated lockouts", async () => {
    await storeCashierSnapshot(db, snapshot(), NOW);
    let at = NOW;
    for (let i = 0; i < MAX_ATTEMPTS; i++) await offlineSignIn(db, verifyPin, "juan", "000000", at).catch(() => undefined);

    at = new Date(NOW.getTime() + 5 * 60_000 + 1);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await offlineSignIn(db, verifyPin, "juan", "000000", at).catch(() => undefined);

    const [row] = await db.select<{ locked_until: string }>("SELECT locked_until FROM auth_lockouts WHERE username = $1", ["juan"]);
    expect(new Date(row.locked_until).getTime() - at.getTime()).toBe(10 * 60_000);
  });

  it("drops cashiers removed from the snapshot (suspended on the server)", async () => {
    await storeCashierSnapshot(db, snapshot(), NOW);
    await storeCashierSnapshot(db, snapshot({ cashiers: snapshot().cashiers.slice(1) }), NOW);

    await expect(offlineSignIn(db, verifyPin, "juan", "482916", NOW)).rejects.toMatchObject({ reason: "invalid" });
    await expect(offlineSignIn(db, verifyPin, "ana", "739215", NOW)).resolves.toBeTruthy();
  });

  it("refuses users without the pos.access permission", async () => {
    await storeCashierSnapshot(db, snapshot({
      cashiers: [{ ...snapshot().cashiers[0], permissions: ["inventory.view"] }],
    }), NOW);

    await expect(offlineSignIn(db, verifyPin, "juan", "482916", NOW)).rejects.toMatchObject({ reason: "invalid" });
  });
});
