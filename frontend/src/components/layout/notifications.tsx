"use client";

import { Bell, CalendarClock, PackageX } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCount } from "@/lib/format";
import { useStockAlerts } from "@/modules/dashboard/stock-alerts-store";

/**
 * Header notifications. Today they are stock alerts (low stock, expiring
 * batches) from the real stock-alerts endpoint; other notification kinds plug
 * into the same list later.
 */
export function Notifications() {
  const { data, status, load } = useStockAlerts();

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const low = data?.low_stock.total ?? 0;
  const expiring = data?.expiring.total ?? 0;
  const count = status === "forbidden" ? 0 : low + expiring;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" className="relative" aria-label={count > 0 ? `Notifications (${count})` : "Notifications"} data-testid="notifications" />
        }
      >
        <Bell className="size-4.5" aria-hidden />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[0.65rem] font-semibold text-white" aria-hidden>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="font-semibold">Notifications</p>
        </div>
        {count === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">You’re all caught up.</p>
        ) : (
          <ul className="divide-y">
            {low > 0 && (
              <li className="flex gap-3 px-4 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger" aria-hidden>
                  <PackageX className="size-4" />
                </span>
                <div className="grid gap-0.5 text-sm">
                  <p className="font-medium">{formatCount(low)} {low === 1 ? "product is" : "products are"} low on stock</p>
                  <p className="text-muted-foreground">{data?.low_stock.items.slice(0, 2).map((i) => i.name).join(", ")}{low > 2 ? "…" : ""}</p>
                </div>
              </li>
            )}
            {expiring > 0 && (
              <li className="flex gap-3 px-4 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-warning-soft text-warning" aria-hidden>
                  <CalendarClock className="size-4" />
                </span>
                <div className="grid gap-0.5 text-sm">
                  <p className="font-medium">{formatCount(expiring)} {expiring === 1 ? "batch expires" : "batches expire"} within {data?.expiring.window_days} days</p>
                  <p className="text-muted-foreground">Soonest: {data?.expiring.items[0]?.name}</p>
                </div>
              </li>
            )}
          </ul>
        )}
        <div className="border-t px-4 py-2.5 text-sm">
          <Link href="/" className="font-medium text-primary hover:underline">Open dashboard</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
