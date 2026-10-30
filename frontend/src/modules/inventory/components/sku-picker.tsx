"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { formatQuantity } from "@/lib/format";
import { searchSkus } from "@/modules/catalog/api";
import type { Sku } from "@/modules/catalog/types";

/**
 * Finds a stocked SKU by name, code or barcode. A scanned barcode (Enter with
 * exactly one match) is added straight away so the scanner can keep going.
 */
export function SkuPicker({ onPick, exclude }: { onPick: (sku: Sku) => void; exclude: ReadonlySet<string> }) {
  const listId = useId();
  const [text, setText] = useState("");
  const [results, setResults] = useState<Sku[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const search = async (term: string) => {
    const id = ++request.current;
    try {
      const found = await searchSkus(term);
      if (id !== request.current) return found;
      setResults(found);
      setError(null);
      return found;
    } catch (caught) {
      if (id === request.current) setError(caught instanceof Error ? caught.message : "Search failed.");
      return [];
    }
  };

  useEffect(() => {
    const term = text.trim();
    if (term.length < 2) return;
    const timer = window.setTimeout(() => void search(term), 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  const pick = (sku: Sku) => {
    onPick(sku);
    setText("");
    setResults([]);
    setOpen(false);
  };

  // Results of an older, longer search are hidden once the text is too short to search.
  const shown = text.trim().length >= 2 ? results : [];
  const available = shown.filter((sku) => !exclude.has(sku.id));

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        role="combobox"
        aria-expanded={open && available.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Add a product"
        placeholder="Add a product: name, SKU or scan a barcode"
        className="pl-8"
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onKeyDown={async (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const term = text.trim();
          if (!term) return;
          const found = (await search(term)).filter((sku) => !exclude.has(sku.id));
          if (found.length === 1) pick(found[0]);
        }}
      />
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
      {open && available.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-lg border bg-popover p-1 shadow-md">
          {available.map((sku) => (
            <li key={sku.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(sku)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{sku.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{sku.code}{!sku.is_active && " · inactive"}</span>
                </span>
                <span className="numeric shrink-0 text-xs text-muted-foreground">{formatQuantity(sku.stock.quantity_on_hand, sku.base_unit.code)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && shown.length > 0 && available.length === 0 && (
        <p className="mt-1 text-sm text-muted-foreground">Already on this document.</p>
      )}
    </div>
  );
}
