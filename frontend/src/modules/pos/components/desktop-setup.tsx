"use client";

import { MonitorSmartphone } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Panel } from "@/components/panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toApiError } from "@/lib/api";
import { notify } from "@/lib/notify";
import { useAuthStore } from "@/modules/auth/store";
import { setUpDesktopTerminal } from "@/modules/offline/runtime";

/**
 * One-time setup of a desktop terminal, online: registers this computer as a
 * terminal (if it is not one yet), stores its sync token in the Windows
 * Credential Manager, and downloads products, prices, cashiers and its stock
 * allocation. After that it sells with or without internet.
 */
export function DesktopSetup({ onDone }: { onDone: () => Promise<void> }) {
  const offline = useAuthStore((s) => s.session?.mode === "offline");
  const [name, setName] = useState("Checkout lane");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setUpDesktopTerminal(name.trim());
      notify.success("Terminal set up", "Products and stock are downloaded; this terminal can now sell offline.");
      await onDone();
    } catch (caught) {
      setError(caught instanceof Error && !("code" in caught) ? caught.message : toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-md gap-4 py-6">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden>
        <MonitorSmartphone className="size-6" />
      </span>
      <Panel title="Set up this checkout terminal">
        {offline ? (
          <p className="text-muted-foreground">Setting up a terminal needs an internet connection and an online sign-in. Sign in with your password when the connection is back.</p>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <p className="text-muted-foreground">
              This computer will download the products, prices, cashiers and its share of the stock, then sell with or without internet. Sales sync automatically.
              A manager with permission to register terminals does this once.
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="desktop-terminal-name">Terminal name</Label>
              <Input id="desktop-terminal-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" disabled={busy || name.trim() === ""}>{busy ? "Setting up…" : "Set up this terminal"}</Button>
          </form>
        )}
      </Panel>
    </div>
  );
}
