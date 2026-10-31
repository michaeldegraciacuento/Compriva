import type { SyncStatus } from "./sync-engine";

export interface SyncNotice {
  kind: "success" | "info" | "warning" | "error";
  title: string;
  description?: string;
}

/**
 * What a cashier should hear about when the terminal's sync status settles
 * (docs/README.md): going offline, coming back, operations the
 * server refused, new stock conflicts. Compares two settled statuses
 * ("syncing" in between is ignored by the caller); null = nothing to say.
 * Routine syncs stay silent.
 */
export function syncNotices(previous: SyncStatus | null, next: SyncStatus): SyncNotice[] {
  if (previous === null) return []; // the first status after start-up: nothing changed yet
  const notices: SyncNotice[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  if (next.state === "offline" && previous.state !== "offline") {
    notices.push({ kind: "warning", title: "Offline", description: "No connection to the server. Keep selling: sales are saved on this terminal and sent when the connection is back." });
  }
  if (next.state === "idle" && (previous.state === "offline" || previous.state === "error")) {
    const sent = previous.pending - next.pending;
    notices.push({ kind: "success", title: "Back online", description: sent > 0 ? `${plural(sent, "change")} sent to the server.` : "The terminal is up to date." });
  }
  if (next.state === "error" && previous.state !== "error") {
    notices.push({ kind: "error", title: "Sync problem", description: `${next.lastError ?? "The server could not be reached."} Sales are kept on this terminal; it will try again.` });
  }
  if (next.rejected > previous.rejected) {
    const added = next.rejected - previous.rejected;
    notices.push({ kind: "error", title: `${plural(added, "operation")} refused by the server`, description: "They are kept on this terminal. A manager can review them on the Sync page." });
  }
  if ((next.openConflicts ?? 0) > (previous.openConflicts ?? 0)) {
    notices.push({ kind: "warning", title: "Stock conflict to review", description: "A sale synced with less stock than expected. It is recorded; a manager reviews it under Terminals & sync." });
  }
  return notices;
}
