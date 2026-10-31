"use client";

import { Receipt } from "@/modules/pos/components/receipt";
import type { Sale } from "@/modules/pos/types";

import { PAPER_WIDTH, receiptLines, receiptText } from "../receipt-layout";
import type { HardwareSettings } from "../settings";

/**
 * Print preview. For a thermal printer on desktop it shows the exact text the
 * printer receives, character for character at the paper's width; otherwise
 * the receipt as the print dialog will print it.
 */
export function ReceiptPreview({ sale, settings, reprint = false }: { sale: Sale; settings: HardwareSettings; reprint?: boolean }) {
  if (settings.method !== "escpos" || settings.paper === "a4") {
    return <Receipt sale={sale} paper={settings.paper} />;
  }
  const width = PAPER_WIDTH[settings.paper];
  const lines = receiptLines(sale, width, { reprint });
  return (
    <figure className="mx-auto w-fit rounded-md border bg-white p-3 shadow-sm" aria-label={`Preview, ${settings.paper} thermal paper`}>
      <pre className="font-mono text-[11px] leading-tight text-black" style={{ width: `${width}ch` }}>
        {lines.map((line, i) => {
          const text = receiptText([line], width);
          return (
            <span key={i} className={line.kind === "text" && line.bold ? "font-bold" : undefined}>
              {text}
              {"\n"}
            </span>
          );
        })}
      </pre>
      <figcaption className="mt-2 border-t border-dashed pt-1 text-center text-[10px] text-muted-foreground">
        {settings.paper} · {width} characters per line · cut here
      </figcaption>
    </figure>
  );
}
