import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

import type { DeviceIdentity, LocalDatabase, Platform, PrinterAccess, PrinterInfo, TerminalCredentials } from "./types";

/** Must match LOCAL_DB_URL in src-tauri/src/local_db.rs. */
const LOCAL_DB_URL = "sqlite:compriva.db";

/** Must be whitelisted in src-tauri/src/secure_store.rs. */
const DEVICE_TOKEN_KEY = "device_token";

let identity: Promise<DeviceIdentity> | null = null;
let database: Promise<LocalDatabase> | null = null;
let sessionToken: string | null = null;
let deviceToken: string | null | undefined; // undefined = not read yet

async function openDatabase(): Promise<LocalDatabase> {
  const db = await Database.load(LOCAL_DB_URL);
  return {
    select: (sql, params) => db.select(sql, params),
    execute: async (sql, params) => {
      const { rowsAffected } = await db.execute(sql, params);
      return { rowsAffected };
    },
    transaction: async (statements) => {
      await invoke("local_transaction", { db: LOCAL_DB_URL, statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
    },
  };
}

const terminal: TerminalCredentials = {
  async getDeviceToken() {
    if (deviceToken === undefined) {
      deviceToken = await invoke<string | null>("secure_store_get", { key: DEVICE_TOKEN_KEY });
    }
    return deviceToken;
  },
  async setDeviceToken(token) {
    await invoke("secure_store_set", { key: DEVICE_TOKEN_KEY, value: token });
    deviceToken = token;
  },
  async clearDeviceToken() {
    await invoke("secure_store_delete", { key: DEVICE_TOKEN_KEY });
    deviceToken = null;
  },
  setSessionToken(token) {
    sessionToken = token;
  },
  verifyPin: (pin, hash) => invoke<boolean>("verify_pin", { pin, hash }),
};

const printers: PrinterAccess = {
  list: () => invoke<PrinterInfo[]>("list_printers"),
  async printRaw(printer, data, jobName) {
    await invoke("print_raw", { printer, data: Array.from(data), jobName });
  },
};

/** Tauri checkout terminal: offline-capable, bearer-token auth, unique device identity. */
export const desktopPlatform: Platform = {
  kind: "desktop",
  authMode: "bearer",
  terminal,
  printers,

  getDeviceIdentity() {
    identity ??= invoke<DeviceIdentity>("device_identity");
    return identity;
  },

  async getAccessToken() {
    return sessionToken ?? (await terminal.getDeviceToken());
  },

  getLocalDatabase() {
    database ??= openDatabase().catch((error: unknown) => {
      database = null; // allow a retry after a transient failure
      throw error;
    });
    return database;
  },
};
