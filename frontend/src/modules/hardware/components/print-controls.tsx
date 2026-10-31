"use client";

import { AlertTriangle, CheckCircle2, Eye, Printer, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Sale } from "@/modules/pos/types";

import { printSale, usePrintJobs } from "../print-jobs";
import { useHardware } from "../settings";
import { ReceiptPreview } from "./receipt-preview";

/**
 * Printing for one sale: status, print / retry, preview. The sale is already
 * saved when this shows; a failed print only offers a retry and never touches
 * the sale.
 */
export function PrintControls({ sale, reprint = false, onReprint }: {
  sale: Sale;
  reprint?: boolean;
  /** Called before a reprint (e.g. to record it in the audit log). */
  onReprint?: () => Promise<void>;
}) {
  const { settings, load } = useHardware();
  const job = usePrintJobs((s) => s.jobs[sale.id]);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const result = job?.result ?? null;
  const busy = job?.busy ?? false;
  const thermal = settings.method === "escpos" && settings.paper !== "a4";

  return (
    <div className="grid gap-2" data-testid="print-controls">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void printSale(sale, { reprint, before: reprint ? onReprint : undefined })} disabled={busy}>
          {result && !result.ok ? <RotateCcw aria-hidden /> : <Printer aria-hidden />}
          {busy ? "Printing…" : result && !result.ok ? "Retry print" : reprint ? "Reprint" : "Print receipt"}
        </Button>
        {/* With the print dialog the receipt on screen is the preview; thermal printing shows the exact printed text. */}
        {thermal && (
          <Button variant="ghost" onClick={() => setPreview(!preview)} aria-expanded={preview}>
            <Eye aria-hidden /> {preview ? "Hide preview" : "Preview"}
          </Button>
        )}
      </div>
      {result && (
        <p role="status" className={`flex items-start gap-1.5 text-sm ${result.ok ? "text-success" : "text-danger"}`}>
          {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>{result.ok ? result.message : `${result.message} The sale is saved; you can print again any time.`}</span>
        </p>
      )}
      {preview && thermal && <ReceiptPreview sale={sale} settings={settings} reprint={reprint} />}
    </div>
  );
}
