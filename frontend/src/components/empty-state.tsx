import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Shown instead of an empty list or chart: what is missing and why. */
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <Icon className="size-5" />
      </span>
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-xs text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
