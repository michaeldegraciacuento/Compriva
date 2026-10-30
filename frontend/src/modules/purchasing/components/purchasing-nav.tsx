"use client";

import { ClipboardList, History, PackageSearch, Truck } from "lucide-react";

import { LinkButton } from "@/components/link-button";
import type { Tone } from "@/components/status-badge";

import type { OrderStatus } from "../types";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  ordered: { label: "Ordered", tone: "info" },
  partially_received: { label: "Partly received", tone: "warning" },
  received: { label: "Received", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

/** Links between the purchasing pages. */
export function PurchasingNav() {
  return (
    <nav aria-label="Purchasing" className="flex flex-wrap gap-2">
      <LinkButton size="sm" variant="ghost" href="/purchasing"><ClipboardList aria-hidden /> Purchase orders</LinkButton>
      <LinkButton size="sm" variant="ghost" href="/purchasing/suppliers"><Truck aria-hidden /> Suppliers</LinkButton>
      <LinkButton size="sm" variant="ghost" href="/purchasing/deliveries"><History aria-hidden /> Purchase history</LinkButton>
      <LinkButton size="sm" variant="ghost" href="/purchasing/costs"><PackageSearch aria-hidden /> Cost history</LinkButton>
    </nav>
  );
}
