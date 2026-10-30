import type { Price, PriceTier, Sku, UnitRef } from "./types";

/** The current price of a SKU for a tier and unit (base unit by default). */
export function currentPrice(sku: Sku, tier: PriceTier = "retail", unitId: string = sku.base_unit.id): Price | undefined {
  return sku.prices.find((price) => price.tier === tier && price.unit.id === unitId);
}

/** Units a SKU can be counted in, with how many base units each holds. The base unit comes first. */
export function skuUnits(sku: Sku): { unit: UnitRef; factor: string }[] {
  const units = sku.conversions.map((c) => ({ unit: c.unit, factor: c.factor, base: c.is_base }));
  if (!units.some((u) => u.base)) units.unshift({ unit: sku.base_unit, factor: "1", base: true });
  return units.sort((a, b) => Number(b.base) - Number(a.base)).map(({ unit, factor }) => ({ unit, factor }));
}

/** "1 box = 24 pc" */
export function describeConversion(unit: UnitRef, factor: string, base: UnitRef): string {
  return `1 ${unit.code} = ${trimDecimal(factor)} ${base.code}`;
}

/** "24.000000" → "24", "1.2500" → "1.25". Display only. */
export function trimDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}
