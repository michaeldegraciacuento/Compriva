import { describe, expect, it } from "vitest";

import type { SyncStatus } from "./sync-engine";
import { syncNotices } from "./sync-notices";

const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({
  state: "idle", pending: 0, rejected: 0, lastSuccessAt: null, lastError: null, nextAttemptAt: null, openConflicts: 0, ...patch,
});
const titles = (previous: SyncStatus | null, next: SyncStatus) => syncNotices(previous, next).map((n) => `${n.kind}: ${n.title}`);

describe("sync notifications for the cashier", () => {
  it("stay silent at start-up and for routine syncs", () => {
    expect(titles(null, status({ state: "offline" }))).toEqual([]);
    expect(titles(status(), status({ pending: 0 }))).toEqual([]);
  });

  it("say once when the connection drops, and how much was sent when it is back", () => {
    expect(titles(status(), status({ state: "offline", pending: 2 }))).toEqual(["warning: Offline"]);
    expect(titles(status({ state: "offline", pending: 2 }), status({ state: "offline", pending: 3 }))).toEqual([]);
    const back = syncNotices(status({ state: "offline", pending: 3 }), status({ state: "idle", pending: 0 }));
    expect(back).toEqual([{ kind: "success", title: "Back online", description: "3 changes sent to the server." }]);
  });

  it("flag refused operations, new stock conflicts and server errors", () => {
    expect(titles(status({ rejected: 1 }), status({ rejected: 3, openConflicts: 1 }))).toEqual([
      "error: 2 operations refused by the server",
      "warning: Stock conflict to review",
    ]);
    expect(titles(status(), status({ state: "error", lastError: "Server error." }))).toEqual(["error: Sync problem"]);
    expect(titles(status({ openConflicts: 2 }), status({ openConflicts: 1 }))).toEqual([]); // a manager resolved one
  });
});
