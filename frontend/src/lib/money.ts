import type { Money } from "@/types/common";

const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,4}))?$/;

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Rounds a decimal string (up to 4 places, as stored) to centavos, half away
 * from zero, using integer arithmetic so no floating-point error is introduced.
 */
function toCentavos(amount: Money): bigint {
  const match = DECIMAL.exec(amount.trim());
  if (!match) {
    throw new TypeError(`Money must be a decimal string with up to 4 places, got "${amount}"`);
  }
  const [, sign, whole, fraction = ""] = match;
  // BigInt() rather than literals: tsconfig targets ES2017.
  const tenThousandths = BigInt(whole + fraction.padEnd(4, "0"));
  const centavos = (tenThousandths + BigInt(50)) / BigInt(100);
  return sign && centavos !== BigInt(0) ? -centavos : centavos;
}

/** Formats an API money value for display: "1234.5000" → "₱1,234.50". Display only — never parse it back. */
export function formatMoney(amount: Money): string {
  const centavos = toCentavos(amount);
  return pesoFormatter.format(Number(centavos) / 100);
}
