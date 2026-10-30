import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform", () => ({ getPlatform: vi.fn() }));

import { safeNextPath } from "./login-screen";

describe("safeNextPath (open-redirect protection)", () => {
  it("keeps same-app paths", () => {
    expect(safeNextPath("/profile")).toBe("/profile");
    expect(safeNextPath("/reports?range=today")).toBe("/reports?range=today");
  });

  it.each([null, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "falls back to / for %s",
    (value) => {
      expect(safeNextPath(value)).toBe("/");
    },
  );
});
