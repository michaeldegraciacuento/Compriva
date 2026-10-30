import { describe, expect, it } from "vitest";

import { formatCell, groupDigits } from "./format";

describe("report cell formatting", () => {
  it("groups digits on the exact decimal string", () => {
    expect(groupDigits("1234567.5")).toBe("1,234,567.5");
    expect(groupDigits("-1234")).toBe("-1,234");
    expect(groupDigits("999")).toBe("999");
  });

  it("formats each column type", () => {
    expect(formatCell("3045.00", "money")).toBe("₱3,045.00");
    expect(formatCell("15.1", "percent")).toBe("15.1%");
    expect(formatCell(12345, "int")).toBe("12,345");
    expect(formatCell("1.25", "qty")).toBe("1.25");
    expect(formatCell(null, "money")).toBe("—");
  });
});
