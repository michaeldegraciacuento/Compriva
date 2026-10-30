import { uuidv7 } from "@/lib/ids";

import { calculateCart, type CalcSaleDiscount } from "./calculator";
import { parse, ZERO } from "./fixed-point";
import type { CartLine, PosItem, PricedCart, SaleDiscount, SellUnit } from "./types";

/** The unit a line is sold in (falls back to the first unit if the catalog changed). */
export function lineUnit(line: CartLine): SellUnit {
  return line.item.units.find((u) => u.unit.id === line.unitId) ?? line.item.units[0];
}

/** Whether `value` is a valid quantity for the unit: positive, ≤ 4 decimals, whole for count units. */
export function quantityProblem(value: string, unit: SellUnit): string | null {
  let units: bigint;
  try {
    units = parse(value);
  } catch {
    return "Enter a number with up to 4 decimals.";
  }
  if (units <= ZERO) return "Enter a quantity greater than zero.";
  if (!unit.unit.allows_decimal && units % BigInt(10_000) !== ZERO) return `${unit.unit.name} must be a whole number.`;
  return null;
}

/**
 * Adds a scanned or tapped item: the same item, unit and price on an existing
 * line adds one to it, otherwise a new line is appended.
 */
export function addItem(lines: CartLine[], item: PosItem, options: { unitId?: string | null; barcode?: string | null } = {}): CartLine[] {
  const unitId = options.unitId ?? item.matched_unit_id ?? item.units[0]?.unit.id;
  if (!unitId) return lines;

  const index = lines.findIndex((line) => line.item.id === item.id && line.unitId === unitId && !line.priceOverride && !line.discount);
  if (index >= 0) {
    const line = lines[index];
    return lines.map((l, i) => (i === index ? { ...l, quantity: addOne(line.quantity), barcode: l.barcode ?? options.barcode ?? null } : l));
  }
  return [...lines, { key: uuidv7(), item, unitId, quantity: "1", barcode: options.barcode ?? null, priceOverride: null, discount: null }];
}

/** "2" → "3", "1.25" → "2.25"; decimal strings only. */
export function addOne(quantity: string): string {
  const [whole, fraction] = quantity.split(".");
  const next = (BigInt(whole || "0") + BigInt(1)).toString();
  return fraction ? `${next}.${fraction}` : next;
}

export function saleDiscountForCalc(discount: SaleDiscount | null): CalcSaleDiscount | null {
  if (discount === null) return null;
  if (discount.kind === "manual") return { type: discount.type, value: discount.value };
  const { preset } = discount;
  return { type: preset.type, value: preset.value, vat_exempt: preset.is_vat_exempt, max_amount: preset.max_amount };
}

/** Prices the cart with the shared calculator. Lines with an invalid quantity are priced at zero. */
export function priceCart(lines: CartLine[], discount: SaleDiscount | null): PricedCart {
  const resolved = lines.map((line) => {
    const unit = lineUnit(line);
    const valid = quantityProblem(line.quantity, unit) === null;
    return { line, unit, unitPrice: line.priceOverride ?? unit.price, quantity: valid ? line.quantity : "0" };
  });

  const result = calculateCart(
    resolved.map(({ line, unitPrice, quantity }) => ({
      quantity,
      unit_price: unitPrice,
      tax_type: line.item.tax.type,
      tax_rate: line.item.tax.rate,
      tax_inclusive: line.item.tax.inclusive,
      discount: line.discount,
    })),
    saleDiscountForCalc(discount),
  );

  const permissions = new Set<string>();
  for (const line of lines) {
    if (line.priceOverride !== null) permissions.add("pos.price_override");
    if (line.discount !== null) permissions.add("pos.apply_discount");
  }
  if (discount && (discount.kind === "manual" || discount.preset.requires_approval)) permissions.add("pos.apply_discount");

  return {
    lines: resolved.map(({ line, unit, unitPrice }, i) => ({ ...line, unit, unitPrice, amounts: result.lines[i] })),
    totals: result.totals,
    permissions: [...permissions],
  };
}

/** Problems that block payment: invalid quantities, an SC/PWD discount without an ID, etc. */
export function cartProblems(lines: CartLine[], discount: SaleDiscount | null): string[] {
  const problems: string[] = [];
  for (const line of lines) {
    const problem = quantityProblem(line.quantity, lineUnit(line));
    if (problem) problems.push(`${line.item.name}: ${problem}`);
  }
  if (discount?.kind === "preset") {
    if (discount.preset.requires_customer_id && !discount.customerIdNumber?.trim()) problems.push(`Enter the customer's ID number for ${discount.preset.name}.`);
    if (discount.preset.is_vat_exempt && lines.some((line) => line.discount)) problems.push(`${discount.preset.name} cannot be combined with item discounts.`);
  }
  return problems;
}
