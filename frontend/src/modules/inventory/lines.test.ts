import { describe, expect, it } from "vitest";

import type { Sku, UnitRef } from "@/modules/catalog/types";

import { basePreview, lineProblems, newLine, toLineInput } from "./lines";

const PC: UnitRef = { id: "pc", code: "pc", name: "Piece", type: "count", allows_decimal: false };
const BOX: UnitRef = { id: "box", code: "box", name: "Box", type: "count", allows_decimal: false };
const KG: UnitRef = { id: "kg", code: "kg", name: "Kilogram", type: "weight", allows_decimal: true };

function sku(overrides: Partial<Sku> = {}): Sku {
  return {
    id: "sku-1", product_id: "p-1", code: "SKU-00001", name: "Coke 330ml", variant: null,
    base_unit: PC, cost_price: "18.5000", reorder_level: "0.0000", reorder_quantity: "0.0000", is_active: true,
    barcodes: [],
    conversions: [
      { id: "c1", unit: PC, factor: "1.000000", is_base: true, is_purchase_unit: false, is_sales_unit: true },
      { id: "c2", unit: BOX, factor: "24.000000", is_base: false, is_purchase_unit: true, is_sales_unit: false },
    ],
    prices: [],
    stock: { quantity_on_hand: "10.0000", quantity_allocated: "0.0000", average_cost: "18.5000" },
    tracks: { batches: false, expiry: false },
    ...overrides,
  };
}

describe("stock document lines", () => {
  it("starts in the base unit with the SKU cost", () => {
    const line = newLine(sku());
    expect(line.unit_id).toBe("pc");
    expect(line.unit_cost).toBe("18.5");
  });

  it("requires a positive quantity, whole for count units", () => {
    const line = newLine(sku());
    expect(lineProblems("stock_in", line).quantity).toBe("Enter a quantity.");
    expect(lineProblems("stock_in", { ...line, quantity: "0" }).quantity).toBe("Must be greater than zero.");
    expect(lineProblems("stock_in", { ...line, quantity: "1.5" }).quantity).toBe("pc is counted in whole numbers.");
    expect(lineProblems("stock_in", { ...line, quantity: "2.0" })).toEqual({});
  });

  it("allows fractions for weighed goods", () => {
    const line = newLine(sku({ base_unit: KG, conversions: [] }));
    expect(lineProblems("stock_out", { ...line, quantity: "1.25" })).toEqual({});
    expect(lineProblems("stock_out", { ...line, quantity: "1.23456" }).quantity).toMatch(/4 decimals/);
  });

  it("requires batch and expiry on stock-in when the product tracks them", () => {
    const line = { ...newLine(sku({ tracks: { batches: true, expiry: true } })), quantity: "5" };
    expect(lineProblems("stock_in", line)).toEqual({
      batch_number: "Enter the batch or lot number.",
      expiry_date: "Enter the expiry date.",
    });
    // Stock-out picks batches by FEFO, so neither is required there.
    expect(lineProblems("stock_out", line)).toEqual({});
  });

  it("counts in the base unit, allows zero and needs a batch for batch-tracked products", () => {
    const line = newLine(sku({ tracks: { batches: true, expiry: false } }));
    expect(lineProblems("adjustment", { ...line, counted_quantity: "0", stock_batch_id: "b1" })).toEqual({});
    expect(lineProblems("adjustment", { ...line, counted_quantity: "3" }).stock_batch_id).toBe("Choose the batch you counted.");
  });

  it("sends only the fields each document type uses", () => {
    const line = { ...newLine(sku()), unit_id: "box", quantity: " 2 ", unit_cost: "444", batch_number: "", expiry_date: "2026-12-31", counted_quantity: "7" };

    expect(toLineInput("stock_in", line)).toEqual({
      product_sku_id: "sku-1", unit_id: "box", quantity: "2", unit_cost: "444", batch_number: null, expiry_date: "2026-12-31",
    });
    expect(toLineInput("stock_out", line)).toEqual({ product_sku_id: "sku-1", unit_id: "box", quantity: "2", stock_batch_id: null });
    expect(toLineInput("adjustment", line)).toEqual({ product_sku_id: "sku-1", counted_quantity: "7", stock_batch_id: null });
  });

  it("previews the quantity in base units for other units only", () => {
    const line = newLine(sku());
    expect(basePreview({ ...line, quantity: "2" })).toBeNull();
    expect(basePreview({ ...line, unit_id: "box", quantity: "2" })).toBe("= 48 pc");
    expect(basePreview({ ...line, unit_id: "box", quantity: "abc" })).toBeNull();
  });
});
