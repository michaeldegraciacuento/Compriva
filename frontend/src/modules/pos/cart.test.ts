import { describe, expect, it } from "vitest";

import { addItem, addOne, cartProblems, priceCart, quantityProblem } from "./cart";
import { formatUnits } from "./fixed-point";
import type { PosItem, PresetDiscount } from "./types";

const piece = { id: "u-pc", code: "pc", name: "Piece", allows_decimal: false };
const box = { id: "u-box", code: "box", name: "Box", allows_decimal: false };
const kg = { id: "u-kg", code: "kg", name: "Kilogram", allows_decimal: true };

const cornedBeef: PosItem = {
  id: "sku-1", product_id: "p-1", name: "Corned Beef", code: "SKU-1", category_id: null, image_url: null, base_unit_id: "u-pc",
  units: [{ unit: piece, factor: "1.000000", price: "50.0000" }, { unit: box, factor: "12.000000", price: "550.0000" }],
  matched_unit_id: null,
  tax: { id: "t", code: "VAT12", type: "vat", rate: "12.0000", inclusive: true },
  stock: { tracked: true, on_hand: "100.0000", available: "100.0000" },
};
const rice: PosItem = { ...cornedBeef, id: "sku-2", name: "Rice", base_unit_id: "u-kg", units: [{ unit: kg, factor: "1.000000", price: "52.0000" }], tax: { ...cornedBeef.tax, code: "VAT_EXEMPT", type: "vat_exempt", rate: "0.0000" } };
const seniorCitizen: PresetDiscount = {
  id: "sc", code: "SC20", name: "Senior Citizen 20%", kind: "senior_citizen", type: "percentage", value: "20.0000",
  is_vat_exempt: true, requires_customer_id: true, requires_approval: false, max_amount: null, min_purchase: null,
};

describe("cart", () => {
  it("adds a second scan of the same item and unit to the same line", () => {
    let lines = addItem([], cornedBeef);
    lines = addItem(lines, cornedBeef);
    lines = addItem(lines, { ...cornedBeef, matched_unit_id: "u-box" }, { barcode: "BOX-1" });
    expect(lines.map((l) => [l.unitId, l.quantity])).toEqual([["u-pc", "2"], ["u-box", "1"]]);
    expect(lines[1].barcode).toBe("BOX-1");
  });

  it("checks quantities against the unit", () => {
    expect(quantityProblem("1.5", cornedBeef.units[0])).toBe("Piece must be a whole number.");
    expect(quantityProblem("1.25", rice.units[0])).toBeNull();
    expect(quantityProblem("0", rice.units[0])).toMatch(/greater than zero/);
    expect(quantityProblem("abc", rice.units[0])).toMatch(/number/);
    expect(addOne("1.25")).toBe("2.25");
  });

  it("prices the cart with the shared calculator and lists the approvals it needs", () => {
    let lines = addItem(addItem([], cornedBeef), rice);
    lines = lines.map((l) => (l.item.id === "sku-2" ? { ...l, quantity: "1.25" } : { ...l, discount: { type: "percentage", value: "10" } }));
    const priced = priceCart(lines, null);
    expect(priced.totals).toMatchObject({ gross_amount: "115.00", discount_total: "5.00", vat_exempt_sales: "65.00", grand_total: "110.00" });
    expect(priced.permissions).toEqual(["pos.apply_discount"]);
  });

  it("applies Senior Citizen discounts VAT-exempt and needs the ID", () => {
    const lines = addItem(addItem([], cornedBeef), cornedBeef);
    const discount = { kind: "preset" as const, preset: seniorCitizen, customerIdNumber: null };
    expect(priceCart(lines, discount).totals.grand_total).toBe("71.43");
    expect(priceCart(lines, discount).permissions).toEqual([]);
    expect(cartProblems(lines, discount)).toEqual(["Enter the customer's ID number for Senior Citizen 20%."]);
    expect(cartProblems(lines, { ...discount, customerIdNumber: "SC-1" })).toEqual([]);
  });

  it("formats quantities without floating point", () => {
    expect(formatUnits(BigInt(25_000))).toBe("2.5");
    expect(formatUnits(BigInt(30_000))).toBe("3");
    expect(formatUnits(BigInt(1))).toBe("0.0001");
  });
});
