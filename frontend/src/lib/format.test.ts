import { describe, expect, it } from "vitest";

import { formatCount, formatMoneyCompact, formatPercentChange, formatQuantity, initials } from "./format";

describe("display formatting", () => {
  it("compacts peso amounts for ticks and tiles", () => {
    expect(formatMoneyCompact("12900.0000")).toBe("₱12.9K");
    expect(formatMoneyCompact("1250000.0000")).toBe("₱1.3M");
    expect(formatMoneyCompact(0)).toBe("₱0");
  });

  it("formats counts and quantities", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatQuantity("1.2500", "kg")).toBe("1.25 kg");
    expect(formatQuantity("12.0000", "pc")).toBe("12 pc");
  });

  it("signs percentage changes with a true minus", () => {
    expect(formatPercentChange("12.44")).toBe("+12.4%");
    expect(formatPercentChange(-3)).toBe("−3.0%");
    expect(formatPercentChange(0)).toBe("0.0%");
  });

  it("builds avatar initials", () => {
    expect(initials("Juan Dela Cruz")).toBe("JC");
    expect(initials("owner")).toBe("O");
    expect(initials("  ")).toBe("?");
  });
});
