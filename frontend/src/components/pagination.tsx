import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import type { PaginationMeta } from "@/types/api";

/** "21–40 of 132" with previous/next. Hidden when everything fits on one page. */
export function Pagination({ meta, onPage }: { meta: PaginationMeta | undefined; onPage: (page: number) => void }) {
  if (!meta || meta.last_page <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-sm text-muted-foreground">
      <span className="numeric">
        {meta.from ?? 0}–{meta.to ?? 0} of {formatCount(meta.total)}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={meta.current_page <= 1} onClick={() => onPage(meta.current_page - 1)}>
          <ChevronLeft aria-hidden /> Previous
        </Button>
        <Button variant="outline" size="sm" disabled={meta.current_page >= meta.last_page} onClick={() => onPage(meta.current_page + 1)}>
          Next <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
