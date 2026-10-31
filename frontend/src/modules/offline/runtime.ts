"use client";

import { create } from "zustand";

import { notify } from "@/lib/notify";
import { useAuthStore } from "@/modules/auth/store";
import { getPlatform } from "@/platform";
import type { LocalDatabase } from "@/platform/types";

import * as posApi from "../pos/api";
import { onlinePos, type PosBackend } from "../pos/backend";
import type { Approval, Sale } from "../pos/types";
import { LocalPos } from "./local-pos";
import { getMeta, META } from "./meta";
import { httpSyncApi, requestSyncToken } from "./sync-api";
import { SyncEngine, type SyncStatus } from "./sync-engine";
import { syncNotices } from "./sync-notices";

/** Live sync status for the header indicator and the Sync page. */
export const useSyncStatus = create<{ status: SyncStatus | null; set(status: SyncStatus): void }>()((set) => ({
  status: null,
  set: (status) => set({ status }),
}));

export interface OfflineRuntime {
  db: LocalDatabase;
  pos: LocalPos;
  engine: SyncEngine;
}

let runtime: Promise<OfflineRuntime | null> | null = null;

/**
 * Desktop only: the local POS and the sync engine, created once. The web app
 * (online-only) gets null and uses the API directly.
 */
export function getOfflineRuntime(): Promise<OfflineRuntime | null> {
  runtime ??= (async () => {
    const platform = await getPlatform();
    if (platform.kind !== "desktop" || !platform.terminal) return null;
    const terminal = platform.terminal;
    const db = (await platform.getLocalDatabase())!;
    let settled: SyncStatus | null = null;

    const engine = new SyncEngine({
      db,
      api: httpSyncApi(() => terminal.getDeviceToken()),
      onStatus: (status) => {
        useSyncStatus.getState().set(status);
        // Small toasts (not pop-ups: selling goes on) for changes a cashier should know about; "syncing" in between is skipped.
        if (status.state === "syncing") return;
        for (const notice of syncNotices(settled, status)) notify.background[notice.kind](notice.title, notice.description);
        settled = status;
      },
    });
    const pos = new LocalPos({
      db,
      verifyPin: (pin, hash) => terminal.verifyPin(pin, hash),
      user: () => {
        const session = useAuthStore.getState().session;
        return session ? { id: session.user.id, name: session.user.name, permissions: session.permissions } : null;
      },
      onChange: () => engine.kick(),
    });

    await engine.refreshStatus();
    if (await isSetUp(db)) engine.start();
    return { db, pos, engine };
  })();
  return runtime;
}

async function isSetUp(db: LocalDatabase): Promise<boolean> {
  return (await getMeta(db, META.setupComplete)) !== null;
}

/**
 * Which POS backend to use: the web app always talks to the API; a desktop
 * terminal sells from its local database once it has been set up.
 */
export async function getPosBackend(): Promise<{ backend: PosBackend; needsSetup: boolean }> {
  const offline = await getOfflineRuntime();
  if (!offline) return { backend: onlinePos, needsSetup: false };
  return { backend: offline.pos, needsSetup: !(await isSetUp(offline.db)) };
}

/** A sale from this terminal's local database (desktop), or else from the server. */
export async function fetchSaleAnywhere(id: string): Promise<{ sale: Sale; local: boolean }> {
  const offline = await getOfflineRuntime();
  if (offline) {
    try {
      return { sale: await offline.pos.fetchSale(id), local: true };
    } catch {
      // not a sale of this terminal: ask the server
    }
  }
  return { sale: await posApi.fetchSale(id), local: false };
}

/** Voids a sale where it lives: the local terminal (synced later) or the server. */
export async function voidSaleAnywhere(id: string, local: boolean, reason: string, approval: Approval | null): Promise<Sale> {
  const offline = local ? await getOfflineRuntime() : null;
  return offline ? offline.pos.voidSale(id, reason, approval) : posApi.voidSale(id, reason, approval);
}

/**
 * First-time setup of a desktop terminal (online, once): register the computer
 * if needed, get its device sync token, download the snapshot and stock.
 */
export async function setUpDesktopTerminal(name: string): Promise<void> {
  const offline = (await getOfflineRuntime())!;
  const platform = await getPlatform();

  const bootstrap = await onlinePos.bootstrap();
  if (!bootstrap.terminal) await onlinePos.registerTerminal(name);
  await platform.terminal!.setDeviceToken(await requestSyncToken());

  const report = await offline.engine.syncNow();
  if (report.outcome === "offline" || report.outcome === "failed" || !(await isSetUp(offline.db))) {
    throw new Error(report.message ?? "The terminal could not download its data. Try again.");
  }
  offline.engine.start();
}
