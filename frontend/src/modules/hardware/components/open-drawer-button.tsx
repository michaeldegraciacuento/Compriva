"use client";

import { Archive } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiClient } from "@/lib/api";
import { notify } from "@/lib/notify";
import { useCan } from "@/modules/auth/hooks";

import { openDrawer } from "../printing";
import { useHardware } from "../settings";

/**
 * "No sale": opens the cash drawer through the receipt printer, with a reason.
 * Needs pos.open_drawer. Recorded in the audit log when the server can be
 * reached; the drawer opens either way.
 */
export function OpenDrawerButton() {
  const allowed = useCan("pos.open_drawer");
  const { settings, load } = useHardware();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!allowed) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await load();
    const result = await openDrawer(useHardware.getState().settings);
    if (result.ok) {
      try {
        const api = await getApiClient();
        await api.ensureCsrfCookie();
        await api.post("/pos/drawer-opened", { reason: reason.trim() });
      } catch {
        // offline: the drawer still opened; nothing to block
      }
      notify.success("Drawer opened", "Recorded with your reason.");
      setOpen(false);
      setReason("");
      setMessage(null);
    } else {
      setMessage({ ok: false, text: result.message });
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); setMessage(null); }}>
      <DialogTrigger render={<Button variant="outline" disabled={!settings} />}>
        <Archive aria-hidden /> Open drawer
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Open the cash drawer</DialogTitle>
          <DialogDescription>Without a sale, e.g. to give change. The reason is recorded.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="drawer-reason">Reason</Label>
            <Input id="drawer-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} autoFocus />
          </div>
          {message && <Alert variant="destructive"><AlertDescription>{message.text}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="submit" disabled={busy || reason.trim().length < 3}>{busy ? "Opening…" : "Open drawer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
