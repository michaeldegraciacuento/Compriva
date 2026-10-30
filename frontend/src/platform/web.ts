import type { DeviceIdentity, Platform } from "./types";

const INSTALL_ID_KEY = "compriva.install_id";
const createdAt = new Date().toISOString();
let fallbackId: string | null = null;

/**
 * A browser's terminal identity: a random install ID kept in local storage, so
 * a browser can be registered as a checkout terminal (docs/point-of-sale.md §2).
 * Clearing site data gives the browser a new ID, and it must be registered again.
 */
function browserIdentity(): DeviceIdentity {
  let installId: string | null = null;
  try {
    installId = window.localStorage.getItem(INSTALL_ID_KEY);
    if (!installId) {
      installId = crypto.randomUUID();
      window.localStorage.setItem(INSTALL_ID_KEY, installId);
    }
  } catch {
    // Storage blocked (private mode): this tab still gets a stable ID until it closes.
    installId = fallbackId ??= crypto.randomUUID();
  }
  return { installId, createdAt, machineName: "Web browser", os: "web", appVersion: "web" };
}

/** Browser management app: online-only, Sanctum cookie session. */
export const webPlatform: Platform = {
  kind: "web",
  authMode: "cookie",
  getDeviceIdentity: async () => (typeof window === "undefined" ? null : browserIdentity()),
  getAccessToken: async () => null,
  getLocalDatabase: async () => null,
  terminal: null,
};
