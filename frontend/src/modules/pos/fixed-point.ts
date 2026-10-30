/**
 * Integer fixed-point arithmetic for checkout. No floating point: decimals are
 * parsed into BigInt centavos (or 1/10000 units for quantities, prices and
 * rates) and every division rounds half away from zero.
 *
 * Mirrors backend/app/Domain/Sales/Pricing/FixedPoint.php; keep them identical.
 */

// BigInt() rather than literals: tsconfig targets ES2017.
export const ZERO = BigInt(0);
export const ONE = BigInt(1);
export const TWO = BigInt(2);
export const HUNDRED = BigInt(100);
/** Scale for quantities, unit prices and rates: 4 decimals. */
export const SCALE = BigInt(10_000);
export const MILLION = BigInt(1_000_000);

const FOUR_PLACES = /^(-)?(\d{1,13})(?:\.(\d{1,4}))?$/;
const ANY_PLACES = /^(-)?(\d+)(?:\.(\d*))?$/;

/** "12.5" → 125000n (4 decimals). Throws on more than 4 decimals or anything that is not a plain decimal. */
export function parse(value: string): bigint {
  const match = FOUR_PLACES.exec(value.trim());
  if (!match) throw new RangeError(`Not a decimal with up to 4 places: "${value}"`);
  const units = BigInt(match[2] + (match[3] ?? "").padEnd(4, "0"));
  return match[1] ? -units : units;
}

/** a ÷ b rounded half away from zero; b must be positive. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b <= ZERO) throw new RangeError("Divisor must be positive.");
  const abs = a < ZERO ? -a : a;
  const q = (abs * TWO + b) / (TWO * b);
  return a < ZERO ? -q : q;
}

/** Decimal string (up to 4 places) → centavos, half up. */
export function cents(value: string): bigint {
  return divRound(parse(value), HUNDRED);
}

/** Decimal string of any precision → centavos, half up. */
export function roundCents(value: string): bigint {
  const match = ANY_PLACES.exec(value.trim());
  if (!match) throw new RangeError(`Not a decimal: "${value}"`);
  const fraction = (match[3] ?? "").padEnd(3, "0");
  const result = BigInt(match[2]) * HUNDRED + BigInt(fraction.slice(0, 2)) + (fraction[2] >= "5" ? ONE : ZERO);
  return match[1] ? -result : result;
}

/** 12345n → "123.45". */
export function format(value: bigint): string {
  const sign = value < ZERO ? "-" : "";
  const abs = value < ZERO ? -value : value;
  return `${sign}${abs / HUNDRED}.${(abs % HUNDRED).toString().padStart(2, "0")}`;
}

/** Decimal string → "123.45", for amounts typed by the cashier. Returns null when it is not a valid amount. */
export function normalizeAmount(value: string): string | null {
  try {
    return format(cents(value));
  } catch {
    return null;
  }
}

/**
 * Splits `amount` centavos across lines in proportion to `weights` (largest
 * remainder). The parts always add up to exactly `amount`; leftover centavos go
 * to the largest fractional parts, ties to the earlier line.
 */
export function allocate(amount: bigint, weights: bigint[]): bigint[] {
  const total = weights.reduce((sum, w) => sum + w, ZERO);
  if (total <= ZERO || amount === ZERO) return weights.map(() => ZERO);

  const parts = weights.map((w) => (amount * w) / total);
  const remainders = weights.map((w) => (amount * w) % total);
  let left = amount - parts.reduce((sum, p) => sum + p, ZERO);

  const order = weights.map((_, i) => i).sort((a, b) => (remainders[b] > remainders[a] ? 1 : remainders[b] < remainders[a] ? -1 : a - b));
  for (const i of order) {
    if (left <= ZERO) break;
    parts[i] += ONE;
    left -= ONE;
  }
  return parts;
}

export const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const sum = (values: bigint[]): bigint => values.reduce((total, v) => total + v, ZERO);

/** 1/10000 units → a trimmed decimal: 25000n → "2.5", 30000n → "3". */
export function formatUnits(units: bigint): string {
  const sign = units < ZERO ? "-" : "";
  const abs = units < ZERO ? -units : units;
  const fraction = (abs % SCALE).toString().padStart(4, "0").replace(/0+$/, "");
  return `${sign}${abs / SCALE}${fraction ? `.${fraction}` : ""}`;
}
