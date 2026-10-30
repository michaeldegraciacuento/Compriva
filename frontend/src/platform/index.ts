import { isTauri } from "@tauri-apps/api/core";

import type { Platform } from "./types";
import { webPlatform } from "./web";

export type * from "./types";

let current: Promise<Platform> | null = null;

/**
 * Resolves the platform the UI is running on. Browser-only: call it from
 * client components or effects, never during server rendering or prerendering.
 * The desktop implementation is loaded lazily so the web bundle does not
 * include Tauri plugins.
 */
export function getPlatform(): Promise<Platform> {
  if (typeof window === "undefined") {
    throw new Error("getPlatform() is only available in the browser");
  }
  current ??= isTauri()
    ? import("./desktop").then((m) => m.desktopPlatform)
    : Promise.resolve(webPlatform);
  return current;
}
