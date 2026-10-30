import { ShoppingBasket } from "lucide-react";

import { cn } from "@/lib/utils";

/** Compriva logo mark + wordmark. */
export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
        <ShoppingBasket className="size-4.5" strokeWidth={2.25} />
      </span>
      {!compact && (
        <span className="grid leading-tight">
          <span className="text-[0.95rem] font-semibold tracking-tight">Compriva</span>
          <span className="text-xs text-muted-foreground">Grocery POS &amp; Retail</span>
        </span>
      )}
    </div>
  );
}
