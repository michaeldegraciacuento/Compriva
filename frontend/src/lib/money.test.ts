import { describe, expect, it } from "vitest";

import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats API decimal strings as pesos", () => {
    expect(formatMoney("1234.5000")).toBe("₱1,234.50");
    expect(formatMoney("0.0500")).toBe("₱0.05");
    expect(formatMoney("75")).toBe("₱75.00");
    expect(formatMoney("-12.5000")).toBe("-₱12.50");
  });

  it("rounds the 4-decimal storage value half away from zero without float error", () => {
    expect(formatMoney("10.0050")).toBe("₱10.01");
    expect(formatMoney("10.0049")).toBe("₱10.00");
    expect(formatMoney("1.0050")).toBe("₱1.01");
    expect(formatMoney("-0.0049")).toBe("₱0.00");
  });

  it("rejects values that are not decimal strings", () => {
    expect(() => formatMoney("12.34567")).toThrow(TypeError);
    expect(() => formatMoney("₱12")).toThrow(TypeError);
    expect(() => formatMoney("")).toThrow(TypeError);
  });
});
