import { Package } from "lucide-react";

import { cn } from "@/lib/utils";

/** Square product thumbnail with a neutral placeholder when there is no image. */
export function ProductThumb({ url, name, className }: { url: string | null; name: string; className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted text-muted-foreground", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- API-served images; next/image is unavailable in the static export
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Package className="size-1/2" aria-hidden />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
