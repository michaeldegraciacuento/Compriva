"use client";

import { create } from "zustand";

import { getPlatform } from "@/platform";

import { DEFAULT_SCANNER, type ScannerSettings } from "./scanner";

export type Paper = "58mm" | "80mm" | "a4";

/**
 * Hardware settings belong to the computer (its printer, its drawer), not to
 * the store: kept in the terminal's local database on desktop, in this
 * browser's storage on the web.
 */
export interface HardwareSettings {
  /** Windows printer name for raw (ESC/POS) printing; desktop only. */
  printer: string | null;
  paper: Paper;
  /** escpos: straight to a thermal printer (desktop). system: the print dialog (web, A4, any printer). */
  method: "escpos" | "system";
  autoPrint: boolean;
  copies: 1 | 2;
  /** Pulse the drawer after cash sales (drawer wired to the receipt printer). */
  openDrawerOnCash: boolean;
  drawerPin: 0 | 1;
  scanner: ScannerSettings;
}

export const DEFAULT_HARDWARE: HardwareSettings = {
  printer: null,
  paper: "80mm",
  method: "system",
  autoPrint: false,
  copies: 1,
  openDrawerOnCash: false,
  drawerPin: 0,
  scanner: DEFAULT_SCANNER,
};

const KEY = "hardware";
const WEB_KEY = "compriva.hardware";

async function load(): Promise<HardwareSettings> {
  const platform = await getPlatform();
  let raw: string | null = null;
  try {
    const db = await platform.getLocalDatabase();
    if (db) {
      const [row] = await db.select<{ value: string }>("SELECT value FROM local_meta WHERE key = $1", [KEY]);
      raw = row?.value ?? null;
    } else {
      raw = window.localStorage.getItem(WEB_KEY);
    }
  } catch {
    raw = null; // storage unavailable: defaults
  }
  const stored = raw ? (JSON.parse(raw) as Partial<HardwareSettings>) : {};
  const settings = { ...DEFAULT_HARDWARE, ...stored, scanner: { ...DEFAULT_SCANNER, ...stored.scanner } };
  // Raw printing needs the desktop app.
  return platform.printers ? settings : { ...settings, method: "system", openDrawerOnCash: false };
}

async function save(settings: HardwareSettings): Promise<void> {
  const platform = await getPlatform();
  const db = await platform.getLocalDatabase();
  const value = JSON.stringify(settings);
  if (db) {
    await db.execute(
      "INSERT INTO local_meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      [KEY, value],
    );
  } else {
    window.localStorage.setItem(WEB_KEY, value);
  }
}

export const useHardware = create<{
  settings: HardwareSettings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<HardwareSettings>): Promise<void>;
}>()((set, get) => ({
  settings: DEFAULT_HARDWARE,
  loaded: false,
  async load() {
    if (get().loaded) return;
    set({ settings: await load(), loaded: true });
  },
  async update(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await save(settings);
  },
}));
