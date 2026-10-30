import { allocate, cents, divRound, format, MILLION, min, parse, SCALE, sum, ZERO } from "./fixed-point";

/**
 * Prices a cart exactly like the server's CartCalculator
 * (backend/app/Domain/Sales/Pricing/CartCalculator.php), so the total on the
 * screen is the total that will be charged. Both are tested against
 * shared/fixtures/checkout-calculations.json. The server still recalculates
 * at checkout and refuses a sale whose total differs (TOTAL_MISMATCH).
 */

export type TaxType = "vat" | "vat_exempt" | "zero_rated" | "non_vat";
export type DiscountType = "percentage" | "fixed_amount";

export interface CalcDiscount {
  type: DiscountType;
  value: string;
}

export interface CalcLine {
  quantity: string;
  unit_price: string;
  tax_type: TaxType;
  tax_rate: string;
  tax_inclusive: boolean;
  discount?: CalcDiscount | null;
}

export interface CalcSaleDiscount extends CalcDiscount {
  vat_exempt?: boolean;
  max_amount?: string | null;
}

export interface LineAmounts {
  gross: string;
  item_discount: string;
  sale_discount: string;
  discount: string;
  taxable: string;
  tax: string;
  total: string;
  vat_exempted: boolean;
}

export interface CartTotals {
  gross_amount: string;
  discount_total: string;
  vatable_sales: string;
  vat_amount: string;
  vat_exempt_sales: string;
  zero_rated_sales: string;
  grand_total: string;
}

/** Discount in centavos on `base` centavos: a percentage, or a fixed amount capped at the base. */
function discountOn(discount: CalcDiscount | null | undefined, base: bigint): bigint {
  if (!discount) return ZERO;
  return discount.type === "percentage" ? min(base, divRound(base * parse(discount.value), SCALE * BigInt(100))) : min(base, cents(discount.value));
}

export function calculateCart(lines: CalcLine[], saleDiscount: CalcSaleDiscount | null = null): { lines: LineAmounts[]; totals: CartTotals } {
  const vatExempt = Boolean(saleDiscount?.vat_exempt);

  const rows = lines.map((line) => {
    const gross = divRound(parse(line.quantity) * parse(line.unit_price), SCALE * BigInt(100));
    const itemDiscount = discountOn(line.discount, gross);
    const net = gross - itemDiscount;
    const rate = line.tax_type === "vat" ? parse(line.tax_rate) : ZERO;
    // Statutory (VAT-exempt) discounts are computed on the price without VAT.
    const base = vatExempt && line.tax_type === "vat" && line.tax_inclusive ? divRound(net * MILLION, MILLION + rate) : net;
    return { gross, itemDiscount, base, rate, type: line.tax_type, inclusive: line.tax_inclusive };
  });

  const bases = rows.map((row) => row.base);
  let saleAmount = saleDiscount ? discountOn(saleDiscount, sum(bases)) : ZERO;
  if (saleDiscount?.max_amount) saleAmount = min(saleAmount, cents(saleDiscount.max_amount));
  const shares = allocate(saleAmount, bases);

  const totals = { gross_amount: ZERO, discount_total: ZERO, vatable_sales: ZERO, vat_amount: ZERO, vat_exempt_sales: ZERO, zero_rated_sales: ZERO, grand_total: ZERO };

  const out = rows.map((row, i): LineAmounts => {
    const amount = row.base - shares[i];
    const exempted = vatExempt && row.type === "vat";
    let taxable: bigint;
    let tax: bigint;
    let total: bigint;

    if (row.type === "vat" && !exempted) {
      if (row.inclusive) {
        taxable = divRound(amount * MILLION, MILLION + row.rate);
        tax = amount - taxable;
        total = amount;
      } else {
        taxable = amount;
        tax = divRound(amount * row.rate, SCALE * BigInt(100));
        total = amount + tax;
      }
      totals.vatable_sales += taxable;
      totals.vat_amount += tax;
    } else {
      taxable = amount;
      tax = ZERO;
      total = amount;
      if (row.type === "zero_rated") totals.zero_rated_sales += total;
      else totals.vat_exempt_sales += total;
    }

    const discount = row.itemDiscount + shares[i];
    totals.gross_amount += row.gross;
    totals.discount_total += discount;
    totals.grand_total += total;

    return {
      gross: format(row.gross),
      item_discount: format(row.itemDiscount),
      sale_discount: format(shares[i]),
      discount: format(discount),
      taxable: format(taxable),
      tax: format(tax),
      total: format(total),
      vat_exempted: exempted,
    };
  });

  return {
    lines: out,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, format(value)])) as unknown as CartTotals,
  };
}
