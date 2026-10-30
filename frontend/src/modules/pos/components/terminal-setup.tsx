"use client";

import { MonitorSmartphone, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Panel } from "@/components/panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toApiError } from "@/lib/api";
import { formatMoney, formatTime } from "@/lib/format";

import { usePos } from "../backend-context";
import { normalizeAmount } from "../fixed-point";
import type { PosBootstrap, Shift } from "../types";
import { CloseShiftDialog } from "./close-shift-dialog";

function SetupCard({ icon: Icon, title, children }: { icon: typeof Wallet; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-md gap-4 py-6">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden>
        <Icon className="size-6" />
      </span>
      <Panel title={title}>{children}</Panel>
    </div>
  );
}

/** This computer is not a terminal yet: a manager registers it, others are told to ask. */
export function RegisterTerminal({ bootstrap, onDone }: { bootstrap: PosBootstrap; onDone: () => Promise<void> }) {
  const pos = usePos();
  const [name, setName] = useState("Checkout lane");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pos.registerTerminal(name.trim());
      await onDone();
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupCard icon={MonitorSmartphone} title="Set up this checkout terminal">
      {bootstrap.can_register ? (
        <form className="grid gap-4" onSubmit={submit}>
          <p className="text-muted-foreground">
            Sales, shifts and receipt numbers belong to a terminal. Register this computer once; it gets the next terminal code (T01, T02, …).
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="terminal-name">Terminal name</Label>
            <Input id="terminal-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Button type="submit" disabled={busy || name.trim() === ""}>{busy ? "Registering…" : "Register this computer"}</Button>
        </form>
      ) : (
        <p className="text-muted-foreground">
          This computer is not a checkout terminal yet. Ask a manager to sign in here and register it from the Point of Sale page.
        </p>
      )}
    </SetupCard>
  );
}

/** No shift is open on this terminal: count the starting cash and open one. */
export function OpenShift({ bootstrap, onDone }: { bootstrap: PosBootstrap; onDone: () => Promise<void> }) {
  const pos = usePos();
  const [float, setFloat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = normalizeAmount(float || "0");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (amount === null) return;
    setBusy(true);
    setError(null);
    try {
      await pos.openShift(amount);
      await onDone();
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupCard icon={Wallet} title={`Open a shift on ${bootstrap.terminal?.code}`}>
      <form className="grid gap-4" onSubmit={submit}>
        <p className="text-muted-foreground">Count the cash in the drawer before the first sale. It is the starting amount the drawer is checked against when you close.</p>
        <div className="grid gap-1.5">
          <Label htmlFor="opening-float">Opening cash (₱)</Label>
          <Input id="opening-float" inputMode="decimal" placeholder="0.00" value={float} onChange={(e) => setFloat(e.target.value)} aria-invalid={amount === null || undefined} autoFocus />
          {amount === null && <p className="text-xs text-danger">Enter an amount like 1000 or 1000.50.</p>}
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={busy || amount === null}>{busy ? "Opening…" : `Open shift with ${formatMoney(amount ?? "0")}`}</Button>
      </form>
    </SetupCard>
  );
}

/** Someone else's shift is open on this terminal. Managers can close it. */
export function TerminalBusy({ shift, canManage, onDone }: { shift: Shift; canManage: boolean; onDone: () => Promise<void> }) {
  return (
    <SetupCard icon={Wallet} title={`${shift.terminal.code} is in use`}>
      <div className="grid gap-4">
        <p className="text-muted-foreground">
          {shift.cashier.name} opened a shift here at {formatTime(shift.opened_at)}. Only one shift can be open on a terminal; {shift.cashier.name} must close it first
          {canManage ? ", or you can close it now." : "."}
        </p>
        {canManage && <CloseShiftDialog shift={shift} onClosed={onDone} />}
      </div>
    </SetupCard>
  );
}
