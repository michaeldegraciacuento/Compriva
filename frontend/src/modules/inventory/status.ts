import type { Tone } from "@/components/status-badge";

import type { StockStatus } from "./types";

export const STOCK_STATUS: Record<StockStatus, { tone: Tone; label: string }> = {
  ok: { tone: "success", label: "In stock" },
  low: { tone: "warning", label: "Low" },
  out: { tone: "danger", label: "Out of stock" },
};

/** Badge for a batch's days to expiry (Asia/Manila calendar days, from the API). */
export function expiryStatus(daysLeft: number | null): { tone: Tone; label: string } {
  if (daysLeft === null) return { tone: "neutral", label: "No expiry" };
  if (daysLeft < 0) return { tone: "danger", label: `Expired ${-daysLeft}d ago` };
  if (daysLeft === 0) return { tone: "danger", label: "Expires today" };
  if (daysLeft === 1) return { tone: "danger", label: "Tomorrow" };
  if (daysLeft <= 2) return { tone: "danger", label: `In ${daysLeft} days` };
  if (daysLeft <= 7) return { tone: "warning", label: `In ${daysLeft} days` };
  return { tone: "info", label: `In ${daysLeft} days` };
}
