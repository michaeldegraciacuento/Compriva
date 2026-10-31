import { format, formatDistanceToNowStrict } from "date-fns";

import type { IsoDateTime, Money, Quantity } from "@/types/common";

/**
 * Display formatting only. These functions never feed a calculation: money
 * and quantities stay decimal strings everywhere else (docs/README.md D4).
 */

export { formatMoney } from "./money";

const compactPeso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  notation: "compact",
  maximumFractionDigits: 1,
});

const integer = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 });
const quantity = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 });

/** ₱12.9K, ₱1.2M — chart ticks and dense tiles. Display only. */
export function formatMoneyCompact(amount: Money | number): string {
  return compactPeso.format(typeof amount === "number" ? amount : Number(amount));
}

export function formatCount(value: number): string {
  return integer.format(value);
}

/** "1.25 kg", "12 pc" — trailing zeros of the 4-decimal storage value removed. */
export function formatQuantity(value: Quantity, unit?: string): string {
  const text = quantity.format(Number(value));
  return unit ? `${text} ${unit}` : text;
}

/** "+12.4%", "−3.0%", "0.0%" (true minus sign for legibility). */
export function formatPercentChange(percent: string | number): string {
  const n = typeof percent === "number" ? percent : Number(percent);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

export function formatDate(value: IsoDateTime | Date, pattern = "d MMM yyyy"): string {
  return format(typeof value === "string" ? new Date(value) : value, pattern);
}

export function formatTime(value: IsoDateTime | Date): string {
  return format(typeof value === "string" ? new Date(value) : value, "h:mm a");
}

export function formatRelative(value: IsoDateTime | Date): string {
  return formatDistanceToNowStrict(typeof value === "string" ? new Date(value) : value, { addSuffix: true });
}

/** Two-letter initials for avatars: "Juan Dela Cruz" → "JC". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
