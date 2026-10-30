import { describe, expect, it } from "vitest";

import fixture from "../../../../shared/fixtures/checkout-calculations.json";
import { calculateCart, type CalcLine, type CalcSaleDiscount } from "./calculator";
import { allocate, cents, divRound, format, parse, roundCents } from "./fixed-point";
import { applyTenders } from "./tender";

interface FixtureCase {
  name: string;
  lines: CalcLine[];
  sale_discount?: CalcSaleDiscount;
  expected: { lines: Record<string, string>[]; totals: Record<string, string> };
}

const cases = fixture.cases as unknown as FixtureCase[];

describe("calculateCart (shared worked examples, same as the PHP CartCalculator)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const result = calculateCart(c.lines, c.sale_discount ?? null);
    const lines = result.lines.map(({ gross, discount, taxable, tax, total }) => ({ gross, discount, taxable, tax, total }));
    expect(lines).toEqual(c.expected.lines);
    expect(result.totals).toEqual(c.expected.totals);
  });

  it.each(cases.map((c) => [c.name, c] as const))("totals reconcile: %s", (_, c) => {
    const t = calculateCart(c.lines, c.sale_discount ?? null).totals;
    expect(cents(t.vatable_sales) + cents(t.vat_amount) + cents(t.vat_exempt_sales) + cents(t.zero_rated_sales)).toBe(cents(t.grand_total));
  });
});

describe("fixed-point helpers", () => {
  it("rounds half away from zero without floating point", () => {
    expect(divRound(BigInt(1), BigInt(2))).toBe(BigInt(1));
    expect(divRound(BigInt(-3), BigInt(2))).toBe(BigInt(-2));
    expect(roundCents("0.004999")).toBe(BigInt(0));
    expect(roundCents("0.005")).toBe(BigInt(1));
    expect(format(cents("0.1") + cents("0.2"))).toBe("0.30"); // never 0.30000000000000004
  });

  it("allocates every centavo", () => {
    expect(allocate(BigInt(1000), [BigInt(1), BigInt(1), BigInt(1)])).toEqual([BigInt(334), BigInt(333), BigInt(333)]);
    expect(allocate(BigInt(0), [BigInt(3)])).toEqual([BigInt(0)]);
  });

  it("rejects excess precision and scientific notation", () => {
    expect(() => parse("1e3")).toThrow();
    expect(() => parse("0.12345")).toThrow();
    expect(parse("12.5")).toBe(BigInt(125000));
  });
});

describe("applyTenders (same rules as the PHP TenderCalculator)", () => {
  const cash = (amount: string) => ({ allowsChange: true, amount });
  const gcash = (amount: string) => ({ allowsChange: false, amount });

  it("gives change from cash only", () => {
    expect(applyTenders("650.00", [cash("1000")])).toEqual({ paid: "1000.00", due: "0.00", change: "350.00", problem: null });
    expect(applyTenders("100.00", [gcash("60"), cash("50")])).toMatchObject({ change: "10.00", problem: null });
  });

  it("explains what is wrong", () => {
    expect(applyTenders("100.00", [cash("99.99")]).problem).toBe("₱0.01 is still due.");
    expect(applyTenders("100.00", [gcash("120")]).problem).toMatch(/cannot be more than the amount due/);
    expect(applyTenders("100.00", [gcash("100"), cash("20")]).problem).toMatch(/not needed/);
    expect(applyTenders("100.00", []).due).toBe("100.00");
  });
});
