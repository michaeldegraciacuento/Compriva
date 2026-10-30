/**
 * Platform abstraction: everything that differs between the web app and the
 * Tauri desktop terminal goes through this interface. UI and module code must
 * not import `@tauri-apps/*` directly.
 */

export type PlatformKind = "web" | "desktop";

/**
 * How API requests authenticate:
 * - cookie: Sanctum session cookie (web app, same-site with the API)
 * - bearer: Sanctum token in the Authorization header (desktop terminals)
 */
export type AuthMode = "cookie" | "bearer";

/** Identity of a terminal installation: src-tauri/src/device.rs on desktop, src/platform/web.ts in a browser. */
export interface DeviceIdentity {
  installId: string;
  createdAt: string;
  machineName: string | null;
  os: string;
  appVersion: string;
}

export interface SqlStatement {
  sql: string;
  params?: unknown[];
}

/** Minimal SQL interface over the terminal's local SQLite database. Parameters are $1, $2, … */
export interface LocalDatabase {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  /** Runs the statements in one transaction: all of them are written, or none (src-tauri/src/local_tx.rs). */
  transaction(statements: SqlStatement[]): Promise<void>;
}

/**
 * Terminal credentials (desktop only).
 * - device token: issued at pairing, kept in the Windows Credential Manager
 * - session token: the signed-in cashier's token, kept in memory only
 */
export interface TerminalCredentials {
  getDeviceToken(): Promise<string | null>;
  setDeviceToken(token: string): Promise<void>;
  clearDeviceToken(): Promise<void>;
  setSessionToken(token: string | null): void;
  /** Verifies a PIN against a cached bcrypt hash in native code (offline sign-in). */
  verifyPin(pin: string, hash: string): Promise<boolean>;
}

export interface Platform {
  readonly kind: PlatformKind;
  readonly authMode: AuthMode;

  /** This client's terminal identity: the desktop install, or a browser ID kept in local storage. Null during server rendering. */
  getDeviceIdentity(): Promise<DeviceIdentity | null>;

  /**
   * Bearer token for API requests when authMode is "bearer": the cashier's
   * session token when someone is signed in, otherwise the device token.
   * Web: always null (the session cookie is used instead).
   */
  getAccessToken(): Promise<string | null>;

  /** Desktop: the local SQLite database. Web: null — the web app is online-only. */
  getLocalDatabase(): Promise<LocalDatabase | null>;

  /** Desktop: terminal credentials. Web: null. */
  readonly terminal: TerminalCredentials | null;
}
