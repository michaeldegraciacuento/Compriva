"use client";

import { Archive, Printer, RefreshCw, ScanBarcode } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { SegmentedControl } from "@/components/segmented-control";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/lib/use-api-query";
import { getPlatform } from "@/platform";

import { checkPrinter, listPrinters, openDrawer, printTestPage, type HardwareResult } from "../printing";
import { ScanDetector } from "../scanner";
import { useHardware, type Paper } from "../settings";
import { SAMPLE_SALE as SAMPLE } from "../sample-sale";
import { ReceiptPreview } from "./receipt-preview";

function Result({ result }: { result: HardwareResult | null }) {
  if (!result) return null;
  return <Alert variant={result.ok ? "default" : "destructive"} className="mt-3"><AlertDescription>{result.message}</AlertDescription></Alert>;
}

/**
 * This terminal's hardware: receipt printer, cash drawer, barcode scanner.
 * Settings are stored on this computer (docs/README.md).
 */
export function HardwarePage() {
  const { settings, loaded, load, update } = useHardware();
  const desktop = useApiQuery(["platform-printers"], async () => (await getPlatform()).printers !== null);
  const printers = useApiQuery(["printers", desktop.data], () => (desktop.data ? listPrinters() : Promise.resolve([])));
  const [result, setResult] = useState<HardwareResult | null>(null);
  const [drawerResult, setDrawerResult] = useState<HardwareResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (task: () => Promise<HardwareResult>, show: (r: HardwareResult) => void) => {
    setBusy(true);
    show(await task());
    setBusy(false);
  };

  const isDesktop = desktop.data === true;
  const thermal = settings.method === "escpos" && settings.paper !== "a4";

  return (
    <div className="grid gap-6">
      <PageHeader title="Hardware" description="Receipt printer, cash drawer and barcode scanner of this computer. Settings stay on this computer." />

      <Panel
        title="Receipt printer"
        description={isDesktop ? "Thermal printers print directly (ESC/POS); A4 and other printers use the print dialog." : "In the browser, receipts print through the print dialog. Direct thermal printing and the cash drawer need the desktop app."}
        action={isDesktop && <Button size="sm" variant="ghost" onClick={() => void printers.reload()} aria-label="Refresh printers"><RefreshCw aria-hidden /></Button>}
      >
        <div className="grid gap-4">
          {isDesktop && (
            <div className="grid gap-1.5">
              <Label htmlFor="hw-printer">Printer</Label>
              <select id="hw-printer" value={settings.printer ?? ""} onChange={(e) => void update({ printer: e.target.value || null })} className="h-9 rounded-md border bg-transparent px-2 text-sm">
                <option value="">Choose a printer…</option>
                {(printers.data ?? []).map((p) => <option key={p.name} value={p.name}>{p.name}{p.is_default ? " (default)" : ""} · {p.status}</option>)}
              </select>
              {printers.error && <p className="text-xs text-danger">Cannot list printers: {printers.error.message}</p>}
              {printers.data && (
                <ul className="grid gap-1 text-sm" aria-label="Installed printers">
                  {printers.data.map((p) => (
                    <li key={p.name} className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.name}<span className="block text-xs text-muted-foreground">{p.driver} · {p.port}</span></span>
                      <StatusBadge tone={p.status === "Ready" ? "success" : p.status === "Unknown" ? "neutral" : "danger"}>{p.status}</StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isDesktop && (
            <SegmentedControl
              label="Print method"
              value={settings.method}
              onChange={(method) => void update({ method })}
              options={[{ value: "escpos", label: "Thermal (direct)" }, { value: "system", label: "Print dialog" }]}
            />
          )}
          <SegmentedControl<Paper>
            label="Paper"
            value={settings.paper}
            onChange={(paper) => void update({ paper })}
            options={[{ value: "58mm", label: "58 mm" }, { value: "80mm", label: "80 mm" }, { value: "a4", label: "A4" }]}
          />
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={settings.autoPrint} onCheckedChange={(autoPrint) => void update({ autoPrint })} /> Print automatically after each sale
            </label>
            {thermal && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={settings.copies === 2} onCheckedChange={(two) => void update({ copies: two ? 2 : 1 })} /> Two copies
              </label>
            )}
          </div>
          <div>
            <Button variant="outline" disabled={busy || !loaded} onClick={() => void run(() => printTestPage(settings), setResult)}>
              <Printer aria-hidden /> Print a test page
            </Button>
            {thermal && settings.printer && (
              <Button variant="ghost" className="ml-2" disabled={busy} onClick={() => void run(() => checkPrinter(settings.printer), setResult)}>Check printer</Button>
            )}
            <Result result={result} />
          </div>
        </div>
      </Panel>

      <Panel title="Cash drawer" description="A drawer plugged into the receipt printer's drawer port (RJ11) opens with a printer command.">
        {isDesktop ? (
          <div className="grid gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={settings.openDrawerOnCash} onCheckedChange={(openDrawerOnCash) => void update({ openDrawerOnCash })} /> Open after cash sales
            </label>
            <SegmentedControl
              label="Drawer pin"
              value={String(settings.drawerPin) as "0" | "1"}
              onChange={(pin) => void update({ drawerPin: pin === "1" ? 1 : 0 })}
              options={[{ value: "0", label: "Pin 2 (most drawers)" }, { value: "1", label: "Pin 5" }]}
            />
            <div>
              <Button variant="outline" disabled={busy || !settings.printer} onClick={() => void run(() => openDrawer(settings), setDrawerResult)}>
                <Archive aria-hidden /> Test: open the drawer
              </Button>
              <Result result={drawerResult} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">The cash drawer needs the Compriva desktop app at the checkout.</p>
        )}
      </Panel>

      <ScannerPanel />

      <Panel title="Receipt preview" description={thermal ? "Exactly what the thermal printer receives." : "As the print dialog will print it."}>
        <ReceiptPreview sale={SAMPLE} settings={settings} />
      </Panel>
    </div>
  );
}

/** Scan into the box to check the scanner: shows the code and whether it arrived at scanner speed. */
function ScannerPanel() {
  const { settings, update } = useHardware();
  const [log, setLog] = useState<{ code: string; kind: string; ms: number }[]>([]);
  const [value, setValue] = useState("");
  const timing = useRef<{ first: number; last: number; maxGap: number }>({ first: 0, last: 0, maxGap: 0 });
  const detector = useRef(new ScanDetector(settings.scanner));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const at = event.timeStamp;
    const t = timing.current;
    if (event.key === "Enter") {
      event.preventDefault();
      detector.current.configure(settings.scanner);
      const fast = value.length > 1 && t.maxGap <= settings.scanner.maxGapMs;
      const decision = value.length >= settings.scanner.minLength ? detector.current.accept(value, at) : { kind: "none" as const };
      setLog((current) => [{ code: value, kind: !fast ? "typed (too slow for a scanner)" : decision.kind === "duplicate" ? "double read (ignored)" : decision.kind === "scan" ? "scan" : "too short", ms: Math.round(t.last - t.first) }, ...current].slice(0, 6));
      setValue("");
      timing.current = { first: 0, last: 0, maxGap: 0 };
      return;
    }
    if (event.key.length !== 1) return;
    if (t.first === 0) timing.current = { first: at, last: at, maxGap: 0 };
    else timing.current = { first: t.first, last: at, maxGap: Math.max(t.maxGap, at - t.last) };
  };

  const number = (key: "minLength" | "maxGapMs" | "duplicateWindowMs", label: string, min: number, max: number) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`scanner-${key}`}>{label}</Label>
      <Input id={`scanner-${key}`} type="number" min={min} max={max} value={settings.scanner[key]}
        onChange={(e) => void update({ scanner: { ...settings.scanner, [key]: Math.min(max, Math.max(min, Number(e.target.value) || min)) } })} />
    </div>
  );

  return (
    <Panel title="Barcode scanner" description="USB scanners work like a keyboard: no driver needed. Set the scanner to send Enter after each code.">
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="scanner-test">Test: scan a barcode here</Label>
          <div className="relative">
            <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="scanner-test" className="h-11 pl-10" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} autoComplete="off" />
          </div>
          {log.length > 0 && (
            <ul className="grid gap-1 text-sm" aria-label="Scans">
              {log.map((entry, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="font-mono">{entry.code}</span>
                  <span className={entry.kind === "scan" ? "text-success" : "text-muted-foreground"}>{entry.kind} · {entry.ms} ms</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {number("minLength", "Shortest barcode", 1, 20)}
          {number("maxGapMs", "Max ms between characters", 10, 200)}
          {number("duplicateWindowMs", "Ignore repeats within (ms)", 0, 3000)}
        </div>
      </div>
    </Panel>
  );
}
