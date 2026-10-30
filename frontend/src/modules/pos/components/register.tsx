"use client";

import { History, PauseCircle, Play, Printer, Receipt as ReceiptIcon, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatMoney, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";

import { usePos } from "../backend-context";
import { cartProblems, priceCart } from "../cart";
import { useCartStore } from "../store";
import type { PosBootstrap, PosItem, Sale, Shift } from "../types";
import { CartPanel } from "./cart-panel";
import { CashMovementDialog } from "./cash-movement-dialog";
import { CloseShiftDialog } from "./close-shift-dialog";
import { ItemBrowser } from "./item-browser";
import { PaymentDialog } from "./payment-dialog";
import { printReceipt, Receipt } from "./receipt";

/** The selling screen: items on the left, the cart on the right (stacked on phones). */
export function Register({ bootstrap, shift, onShiftClosed }: { bootstrap: PosBootstrap; shift: Shift; onShiftClosed: () => Promise<void> }) {
  const terminal = bootstrap.terminal!;
  const cart = useCartStore();
  const pos = usePos();
  const [paying, setPaying] = useState(false);
  const [holding, setHolding] = useState(false);
  const [completed, setCompleted] = useState<Sale | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const priced = useMemo(() => priceCart(cart.lines, cart.discount), [cart.lines, cart.discount]);
  const problems = useMemo(() => cartProblems(cart.lines, cart.discount), [cart.lines, cart.discount]);
  const methods = bootstrap.payment_methods;

  const { loadHeld } = cart;
  useEffect(() => loadHeld(terminal.id), [loadHeld, terminal.id]);

  const add = (item: PosItem, options: { unitId?: string | null; barcode?: string | null }) => {
    cart.add(item, options);
    setNotice(null);
  };

  /** After TOTAL_MISMATCH: reload the cart's items so the screen shows the new prices. */
  const refreshPrices = async () => {
    const codes = [...new Set(cart.lines.map((line) => line.item.code))];
    const found = (await Promise.all(codes.map((code) => pos.catalog({ q: code })))).flat();
    cart.replaceItems(found);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Point of Sale</h1>
          <p className="text-sm text-muted-foreground">
            {terminal.code} · {terminal.name} · {shift.cashier.name}, shift since {formatTime(shift.opened_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeldCartsSheet terminalId={terminal.id} />
          <RecentSalesSheet />
          <CashMovementDialog onRecorded={setNotice} />
          <CloseShiftDialog shift={shift} onClosed={onShiftClosed} />
        </div>
      </div>

      {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
        <ItemBrowser categories={bootstrap.categories} onAdd={add} />
        <div className="lg:sticky lg:top-20 lg:h-[calc(100svh-7rem)]">
          <CartPanel priced={priced} presets={bootstrap.discounts} problems={problems} onPay={() => setPaying(true)} onHold={() => setHolding(true)} />
        </div>
      </div>

      {paying && (
        <PaymentDialog
          open
          onOpenChange={setPaying}
          priced={priced}
          methods={methods}
          onPricesChanged={refreshPrices}
          onPaid={(sale) => {
            setPaying(false);
            setCompleted(sale);
            cart.clear();
          }}
        />
      )}
      {holding && (
        <HoldDialog
          onClose={() => setHolding(false)}
          onHold={(label) => {
            const ok = cart.hold(terminal.id, shift.cashier.name, label);
            setNotice(ok ? `Cart held as “${label}”. Resume it from Held carts.` : "The cart could not be held on this computer (storage is full or blocked).");
            setHolding(false);
          }}
        />
      )}
      {completed && <SaleCompleteDialog sale={completed} onClose={() => setCompleted(null)} />}
    </div>
  );
}

function HoldDialog({ onClose, onHold }: { onClose: () => void; onHold: (label: string) => void }) {
  const [label, setLabel] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Hold this cart</DialogTitle>
          <DialogDescription>Serve the next customer and resume this cart later on this terminal.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onHold(label.trim() || `Cart ${formatTime(new Date())}`);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="hold-label">Name (optional)</Label>
            <Input id="hold-label" placeholder="e.g. Lady in red, getting rice" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} autoFocus />
          </div>
          <DialogFooter>
            <Button type="submit"><PauseCircle aria-hidden /> Hold cart</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HeldCartsSheet({ terminalId }: { terminalId: string }) {
  const { held, lines, resume, discardHeld } = useCartStore();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>
        <PauseCircle aria-hidden /> Held carts{held.length > 0 && ` (${held.length})`}
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Held carts</SheetTitle>
          <SheetDescription>{lines.length > 0 ? "Finish or hold the current cart before resuming another." : "Resume a cart to continue selling it."}</SheetDescription>
        </SheetHeader>
        {held.length === 0 ? (
          <EmptyState icon={PauseCircle} title="No held carts" />
        ) : (
          <ul className="divide-y overflow-y-auto px-4">
            {held.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{h.label}</p>
                  <p className="text-xs text-muted-foreground">{h.lines.length} lines · {formatTime(h.heldAt)} · {h.cashierName}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" disabled={lines.length > 0} onClick={() => { resume(terminalId, h.id); setOpen(false); }}>
                    <Play aria-hidden /> Resume
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Discard ${h.label}`} onClick={() => discardHeld(terminalId, h.id)}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** This shift's sales, for reprints, voids and returns. */
function RecentSalesSheet() {
  const pos = usePos();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sales = useApiQuery(["pos-sales", pos.kind, open, q], () => (open ? pos.shiftSales(q || undefined) : Promise.resolve([] as Sale[])));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>
        <History aria-hidden /> Sales
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Sales this shift</SheetTitle>
          <SheetDescription>Open a sale to reprint, void or return items. Search any receipt number.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-3">
          <Input type="search" aria-label="Receipt number" placeholder="Receipt number, e.g. T01-000012" value={q} onChange={(e) => setQ(e.target.value.trim())} />
        </div>
        {sales.error ? (
          <Alert variant="destructive" className="mx-4 w-auto"><AlertDescription>{sales.error.message}</AlertDescription></Alert>
        ) : (sales.data ?? []).length === 0 ? (
          <EmptyState icon={ReceiptIcon} title={sales.loading ? "Loading…" : "No sales yet"} />
        ) : (
          <ul className="divide-y overflow-y-auto px-4">
            {sales.data!.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium">{sale.receipt_number}{sale.status === "voided" && <span className="ml-2 text-xs text-danger">Voided</span>}</p>
                  <p className="text-xs text-muted-foreground">{formatTime(sale.occurred_at)} · {sale.items_count} lines</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="numeric font-medium">{formatMoney(sale.grand_total)}</span>
                  <LinkButton size="sm" variant="outline" href={`/sales/view?id=${sale.id}`}>Open</LinkButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SaleCompleteDialog({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sale complete · {sale.receipt_number}</DialogTitle>
          <DialogDescription>Stock was deducted and the sale is saved.</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-success-soft p-4 text-center text-success">
          <p className="text-sm">Change</p>
          <p className="numeric text-4xl font-bold">{formatMoney(sale.change_due)}</p>
        </div>
        <Receipt sale={sale} />
        <DialogFooter>
          <Button variant="outline" onClick={printReceipt}><Printer aria-hidden /> Print receipt</Button>
          <Button onClick={onClose} autoFocus>New sale</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
