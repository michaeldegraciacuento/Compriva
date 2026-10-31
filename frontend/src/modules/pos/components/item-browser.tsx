"use client";

import { Package, ScanBarcode } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toApiError } from "@/lib/api";
import { formatMoney, formatQuantity } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { useHardware } from "@/modules/hardware/settings";
import { errorBeep, ScanDetector } from "@/modules/hardware/scanner";

import { usePos } from "../backend-context";
import type { PosItem } from "../types";

const looksLikeBarcode = (text: string) => /^[0-9A-Za-z-]{4,64}$/.test(text) && /\d/.test(text);

function stockNote(item: PosItem): { text: string; tone: "muted" | "warning" | "danger" } | null {
  if (!item.stock.tracked) return null;
  const available = Number(item.stock.available); // display only
  if (available <= 0) return { text: "Out of stock", tone: "danger" };
  return { text: `${formatQuantity(item.stock.available)} left`, tone: available <= 5 ? "warning" : "muted" };
}

/**
 * Finding items: scan a barcode, type a name or SKU, or browse a category.
 *
 * A USB scanner types the code and presses Enter. Scans are caught in the scan
 * box and, by their speed, anywhere else on the page that is not a text field
 * (ScanDetector); a double read of the same code within a moment is dropped.
 * A scan that matches one item adds it in the scanned unit (a box barcode adds
 * a box); an unknown barcode beeps and says so.
 */
export function ItemBrowser({ categories, onAdd }: {
  categories: { id: string; name: string }[];
  onAdd: (item: PosItem, options: { unitId?: string | null; barcode?: string | null }) => void;
}) {
  const pos = usePos();
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerSettings = useHardware((st) => st.settings.scanner);
  const detector = useRef<ScanDetector | null>(null);
  detector.current ??= new ScanDetector(scannerSettings);
  const scanRef = useRef<(code: string) => Promise<void>>(async () => undefined);

  const results = useApiQuery(["pos-catalog", term, categoryId], () =>
    term === "" && categoryId === null ? Promise.resolve([] as PosItem[]) : pos.catalog({ q: term || undefined, category_id: categoryId ?? undefined }),
  );

  // Typing searches after a short pause; Enter (or a scanner) acts at once.
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === term) return;
    const timer = window.setTimeout(() => setTerm(trimmed), 300);
    return () => window.clearTimeout(timer);
  }, [text, term]);

  const add = (item: PosItem, options: { unitId?: string | null; barcode?: string | null } = {}) => {
    onAdd(item, options);
    setMessage(null);
    setUnknown(null);
    inputRef.current?.focus();
  };

  const scan = async (code: string) => {
    if (code === "") return;
    setUnknown(null);
    try {
      if (looksLikeBarcode(code)) {
        const [hit] = await pos.catalog({ barcode: code });
        if (hit) {
          add(hit, { unitId: hit.matched_unit_id, barcode: code });
          setText("");
          return;
        }
      }
      const found = await pos.catalog({ q: code });
      if (found.length === 1) {
        add(found[0]);
        setText("");
        return;
      }
      if (found.length === 0 && looksLikeBarcode(code)) {
        // Unknown barcode: tell the cashier clearly; the cart is unchanged.
        errorBeep();
        setUnknown(code);
        setText("");
        inputRef.current?.focus();
        return;
      }
      setTerm(code);
      setMessage(found.length === 0 ? `Nothing found for “${code}”.` : null);
    } catch (caught) {
      setMessage(toApiError(caught).message);
    }
  };

  useEffect(() => {
    scanRef.current = scan;
    detector.current?.configure(scannerSettings);
  });

  useEffect(() => {
    void useHardware.getState().load(); // this terminal's scanner settings
  }, []);

  // Scans made while the cursor is elsewhere (on a button, the cart, nowhere): caught by their speed.
  useEffect(() => {
    const onWindowKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.closest("input, textarea, select, [contenteditable='true']");
      if (editable || event.ctrlKey || event.altKey || event.metaKey) return;
      const decision = detector.current!.key(event.key, event.timeStamp || performance.now());
      if (detector.current!.inBurst(event.timeStamp || performance.now()) || decision.kind !== "none") event.preventDefault();
      if (decision.kind === "scan") void scanRef.current(decision.code);
    };
    window.addEventListener("keydown", onWindowKey, true);
    return () => window.removeEventListener("keydown", onWindowKey, true);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const code = text.trim();
      if (code === "") return;
      if (looksLikeBarcode(code) && detector.current!.accept(code, event.timeStamp || performance.now()).kind === "duplicate") {
        setText(""); // a double read from the scanner: already added
        return;
      }
      void scan(code);
    }
  };

  const items = results.data ?? [];

  return (
    <div className="grid min-w-0 content-start gap-3">
      <div className="relative">
        <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          id="pos-scan"
          type="search"
          aria-label="Scan a barcode or search items"
          placeholder="Scan a barcode, or type a name or SKU"
          className="h-12 pl-10 text-base"
          autoFocus
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Categories">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-pressed={categoryId === category.id}
              onClick={() => setCategoryId((current) => (current === category.id ? null : category.id))}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                categoryId === category.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      {unknown && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Unknown barcode <span className="font-mono font-medium">{unknown}</span>: it is not in the catalog. Search by name, or add the barcode to the product (Products).
          </AlertDescription>
        </Alert>
      )}
      {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
      {results.error && <Alert variant="destructive"><AlertDescription>{results.error.message}</AlertDescription></Alert>}

      {term === "" && categoryId === null ? (
        <EmptyState icon={ScanBarcode} title="Scan an item to start">Or search by name, or pick a category.</EmptyState>
      ) : results.loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Package} title="No items found">Try another name, or check the barcode.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-busy={results.fetching} aria-label="Items">
          {items.map((item) => {
            const note = stockNote(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => add(item)}
                  className="flex h-full w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors outline-none hover:border-primary/60 hover:bg-primary/5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="flex items-start gap-2">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- API-served image, static export
                      <img src={item.image_url} alt="" className="size-10 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="grid size-10 shrink-0 place-items-center rounded bg-muted text-muted-foreground" aria-hidden>
                        <Package className="size-5" />
                      </span>
                    )}
                    <span className="line-clamp-2 min-w-0 font-medium">{item.name}</span>
                  </span>
                  <span className="mt-auto flex items-end justify-between gap-2">
                    <span className="numeric font-semibold">
                      {formatMoney(item.units[0].price)}
                      <span className="font-normal text-muted-foreground"> / {item.units[0].unit.code}</span>
                    </span>
                    {note && (
                      <span className={cn("text-xs", note.tone === "danger" ? "text-danger" : note.tone === "warning" ? "text-warning" : "text-muted-foreground")}>
                        {note.text}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
