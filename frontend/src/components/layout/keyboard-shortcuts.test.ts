import { describe, expect, it } from "vitest";

import type { Session } from "@/modules/auth/types";

import { posShortcut } from "./keyboard-shortcuts";

const session = (permissions: string[]): Session => ({
  user: { id: "u", name: "Juan", username: "cashier1" }, roles: [], permissions, mode: "online", method: "session", device: null,
});
const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

describe("F4 opens the Point of Sale", () => {
  it("opens the POS from any page, or focuses the scan box when already there", () => {
    expect(posShortcut(key("F4"), session(["pos.access"]), "/customers")).toBe("open");
    expect(posShortcut(key("F4"), session(["pos.access"]), "/pos")).toBe("focus");
  });

  it("ignores Alt+F4, other keys, and people without POS access", () => {
    expect(posShortcut(key("F4", { altKey: true }), session(["pos.access"]), "/")).toBeNull();
    expect(posShortcut(key("F5"), session(["pos.access"]), "/")).toBeNull();
    expect(posShortcut(key("F4"), session(["inventory.view"]), "/")).toBeNull();
    expect(posShortcut(key("F4"), null, "/")).toBeNull();
  });
});
