import { formatDate, formatMoney } from "@/lib/format";

import type { ColumnType, ReportValue } from "./api";

export const NUMERIC_TYPES: readonly ColumnType[] = ["int", "qty", "money", "percent"];

/** "1234567.5" → "1,234,567.5"; works on the decimal string, no float conversion. */
export function groupDigits(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Display text for a report cell. Values are exact decimal strings from the server. */
export function formatCell(value: ReportValue | undefined, type: ColumnType): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "money": return formatMoney(String(value));
    case "percent": return `${value}%`;
    case "date": return formatDate(String(value));
    case "int":
    case "qty": return groupDigits(String(value));
    default: return String(value);
  }
}
