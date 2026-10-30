import { describe, expect, it } from "vitest";

import { uuidv7, uuidv7Timestamp } from "./ids";

describe("uuidv7", () => {
  it("produces RFC 9562 version 7 UUIDs", () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("encodes the creation time", () => {
    const at = Date.UTC(2026, 9, 30, 4, 0, 0, 123);
    expect(uuidv7Timestamp(uuidv7(at))).toBe(at);
  });

  it("sorts by creation time", () => {
    const ids = [3, 1, 2].map((offset) => uuidv7(1_800_000_000_000 + offset));
    expect([...ids].sort()).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(0)));
    expect(ids.size).toBe(1000);
  });
});
