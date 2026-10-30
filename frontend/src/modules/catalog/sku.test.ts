import { describe, expect, it } from "vitest";

import { currentPrice, describeConversion, skuUnits, trimDecimal } from "./sku";
import type { Price, Sku, UnitRef } from "./types";

const PC: UnitRef = { id: "pc", code: "pc", name: "Piece", type: "count", allows_decimal: false };
const PACK: UnitRef = { id: "pack", code: "pack", name: "Pack", type: "count", allows_decimal: false };

const price = (id: string, unit: UnitRef, tier: Price["tier"], amount: string): Price =>
  ({ id, unit, tier, price: amount, effective_from: "2026-10-01T00:00:00Z", effective_to: null });

const SKU = {
  id: "s", base_unit: PC,
  conversions: [
    { id: "c2", unit: PACK, factor: "6.000000", is_base: false, is_purchase_unit: false, is_sales_unit: true },
    { id: "c1", unit: PC, factor: "1.000000", is_base: true, is_purchase_unit: false, is_sales_unit: true },
  ],
  prices: [price("p1", PC, "retail", "20.0000"), price("p2", PACK, "retail", "110.0000"), price("p3", PC, "wholesale", "18.0000")],
} as unknown as Sku;

describe("SKU helpers", () => {
  it("finds the current price per tier and unit", () => {
    expect(currentPrice(SKU)?.price).toBe("20.0000");
    expect(currentPrice(SKU, "retail", "pack")?.price).toBe("110.0000");
    expect(currentPrice(SKU, "wholesale")?.price).toBe("18.0000");
    expect(currentPrice(SKU, "member")).toBeUndefined();
  });

  it("lists the base unit first and falls back to it without conversions", () => {
    expect(skuUnits(SKU).map((u) => u.unit.code)).toEqual(["pc", "pack"]);
    expect(skuUnits({ ...SKU, conversions: [] }).map((u) => [u.unit.code, u.factor])).toEqual([["pc", "1"]]);
  });

  it("describes conversions without storage zeros", () => {
    expect(describeConversion(PACK, "6.000000", PC)).toBe("1 pack = 6 pc");
    expect(trimDecimal("1.2500")).toBe("1.25");
    expect(trimDecimal("10.0000")).toBe("10");
    expect(trimDecimal("100")).toBe("100");
  });
});
