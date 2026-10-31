"use client";

import { QrCode, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { notify } from "@/lib/notify";

import { fetchPaymentMethods, removePaymentQr, updatePaymentMethod, uploadPaymentQr } from "../api";
import type { PaymentMethod } from "../types";

/** The store takes Cash, GCash and Maya. GCash and Maya customers scan the QR code uploaded here. */
export function PaymentMethodsPage() {
  const methods = useApiQuery(["payment-methods"], fetchPaymentMethods);

  return (
    <div className="grid gap-6">
      <PageHeader title="Payment methods" description="Cash, GCash and Maya. Upload the store's GCash and Maya QR codes; the POS shows them to the customer." />
      {methods.error && <Alert variant="destructive"><AlertDescription>{methods.error.message}</AlertDescription></Alert>}
      {!methods.data ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-3">
          {methods.data.map((method) => <MethodCard key={method.id} method={method} onChange={methods.reload} />)}
        </div>
      )}
    </div>
  );
}

function MethodCard({ method, onChange }: { method: PaymentMethod; onChange: () => Promise<void> }) {
  const [accountName, setAccountName] = useState(method.account_name ?? "");
  const [accountNumber, setAccountNumber] = useState(method.account_number ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isCash = method.allows_change;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await action();
      await onChange();
      setSaved(true);
      notify.success(`${method.name} saved`);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={method.name}
      description={isCash ? "Always on. Change is given in cash." : "Paid by QR code, exact amount, with a reference number."}
      action={
        <Switch
          aria-label={`Accept ${method.name}`}
          checked={method.is_active}
          disabled={isCash || busy}
          onCheckedChange={(checked) => void run(() => updatePaymentMethod(method.id, { is_active: checked }))}
        />
      }
    >
      {!isCash && (
        <div className="grid gap-4">
          <div className="grid justify-items-center gap-2 rounded-lg border bg-muted/40 p-3">
            {method.qr_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- QR served by the API, static export
              <img src={method.qr_url} alt={`${method.name} QR code`} className="size-40 rounded bg-white object-contain p-1" />
            ) : (
              <div className="grid size-40 place-items-center text-center text-sm text-muted-foreground">
                <QrCode className="size-8" aria-hidden />
                No QR code yet
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label={`${method.name} QR code image`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void run(() => uploadPaymentQr(method.id, file));
                }}
              />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden /> {method.qr_url ? "Replace QR" : "Upload QR"}
              </Button>
              {method.qr_url && (
                <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${method.name} QR code`} onClick={() => void run(() => removePaymentQr(method.id))}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
          </div>

          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => updatePaymentMethod(method.id, { account_name: accountName.trim() || null, account_number: accountNumber.trim() || null }));
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`${method.code}-name`}>Account name</Label>
              <Input id={`${method.code}-name`} value={accountName} onChange={(e) => setAccountName(e.target.value)} maxLength={100} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${method.code}-number`}>Account number</Label>
              <Input id={`${method.code}-number`} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} maxLength={50} placeholder="0917 123 4567" />
            </div>
            <Button type="submit" variant="outline" disabled={busy}>Save details</Button>
          </form>
        </div>
      )}
      {error && <Alert variant="destructive" className="mt-3"><AlertDescription>{error}</AlertDescription></Alert>}
      {saved && !error && <p className="mt-3 text-sm text-success" role="status">Saved.</p>}
    </Panel>
  );
}
