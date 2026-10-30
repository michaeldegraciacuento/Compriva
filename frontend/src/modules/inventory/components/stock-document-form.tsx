"use client";

import { PackagePlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { SelectField } from "@/components/select-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { formatDate, formatQuantity } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { RequirePermission } from "@/modules/auth/components/auth-guard";
import { useCan } from "@/modules/auth/hooks";
import { skuUnits } from "@/modules/catalog/sku";

import { createDocument, fetchBatches } from "../api";
import { basePreview, lineProblems, type LineDraft, type LineProblems, newLine, toLineInput } from "../lines";
import { REASONS, type DocumentType } from "../types";
import { SkuPicker } from "./sku-picker";

const COPY: Record<DocumentType, { title: string; description: string; submit: string; empty: string }> = {
  stock_in: {
    title: "Stock in",
    description: "Receive stock that is not on a purchase order: deliveries, transfers in, found stock or opening balances.",
    submit: "Post stock in",
    empty: "Add the products you received.",
  },
  stock_out: {
    title: "Stock out",
    description: "Remove damaged, expired, lost or internally used stock. Batches leave earliest-expiry first (FEFO) unless you pick one.",
    submit: "Post stock out",
    empty: "Add the products leaving the store.",
  },
  adjustment: {
    title: "Stock count",
    description: "Enter what you physically counted. The difference from the system quantity is posted as an adjustment.",
    submit: "Post count",
    empty: "Add the products you counted.",
  },
};

/** Batch choice for a line: optional for stock-out (FEFO otherwise), required for counting batch-tracked products. */
function BatchSelect({ line, type, error, onChange }: { line: LineDraft; type: DocumentType; error?: string; onChange: (id: string) => void }) {
  const batches = useApiQuery(["batches", line.sku.id], () => fetchBatches({ sku_id: line.sku.id }));
  const id = `line-${line.key}-batch`;

  return (
    <SelectField id={id} label="Batch" error={error} value={line.stock_batch_id} onChange={(e) => onChange(e.target.value)}>
      <option value="">{type === "stock_out" ? "Automatic (earliest expiry first)" : "Choose the batch…"}</option>
      {batches.data?.data.map((b) => (
        <option key={b.id} value={b.id}>
          {b.batch_number}{b.expiry_date ? ` · exp ${formatDate(b.expiry_date)}` : ""} · {formatQuantity(b.remaining_quantity)} left
        </option>
      ))}
    </SelectField>
  );
}

function LineEditor({ type, line, problems, onChange, onRemove }: {
  type: DocumentType;
  line: LineDraft;
  problems: LineProblems;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  const id = (field: string) => `line-${line.key}-${field}`;
  const tracks = line.sku.tracks ?? { batches: false, expiry: false };
  const units = skuUnits(line.sku);
  const preview = type !== "adjustment" ? basePreview(line) : null;

  const field = (name: keyof LineProblems, label: string, props: React.ComponentProps<typeof Input>, hint?: string | null) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id(name)}>{label}</Label>
      <Input id={id(name)} aria-invalid={problems[name] ? true : undefined} aria-describedby={problems[name] ? `${id(name)}-error` : undefined}
        value={line[name]} onChange={(e) => onChange({ [name]: e.target.value })} {...props} />
      {problems[name] ? (
        <p id={`${id(name)}-error`} role="alert" className="text-sm text-destructive">{problems[name]}</p>
      ) : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return (
    <li className="grid gap-3 rounded-lg border p-4" data-testid={`line-${line.sku.code}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{line.sku.name}</p>
          <p className="numeric text-xs text-muted-foreground">
            {line.sku.code} · {formatQuantity(line.sku.stock.quantity_on_hand, line.sku.base_unit.code)} on hand
            {tracks.expiry && " · expiry tracked"}
          </p>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${line.sku.name}`} onClick={onRemove}><Trash2 aria-hidden /></Button>
      </div>

      {type === "adjustment" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("counted_quantity", `Counted (${line.sku.base_unit.code})`, { inputMode: "decimal", autoFocus: true },
            line.stock_batch_id ? "Count of the selected batch only." : `System: ${formatQuantity(line.sku.stock.quantity_on_hand, line.sku.base_unit.code)}`)}
          {tracks.batches && <BatchSelect line={line} type={type} error={problems.stock_batch_id} onChange={(stock_batch_id) => onChange({ stock_batch_id })} />}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {field("quantity", "Quantity", { inputMode: "decimal", autoFocus: true }, preview)}
          <SelectField id={id("unit")} label="Unit" value={line.unit_id} onChange={(e) => onChange({ unit_id: e.target.value })}>
            {units.map(({ unit, factor }) => (
              <option key={unit.id} value={unit.id}>{unit.name}{factor !== "1" && Number(factor) !== 1 ? ` (${Number(factor)} ${line.sku.base_unit.code})` : ""}</option>
            ))}
          </SelectField>
          {type === "stock_in"
            ? field("unit_cost", "Unit cost (₱)", { inputMode: "decimal" }, "Per selected unit. Updates the average cost.")
            : <BatchSelect line={line} type={type} onChange={(stock_batch_id) => onChange({ stock_batch_id })} />}
        </div>
      )}

      {type === "stock_in" && (tracks.batches || tracks.expiry) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("batch_number", tracks.batches ? "Batch / lot number" : "Batch / lot number (optional)", { autoComplete: "off" })}
          {field("expiry_date", tracks.expiry ? "Expiry date" : "Expiry date (optional)", { type: "date" })}
        </div>
      )}
    </li>
  );
}

/** Maps "lines.2.quantity" server errors onto the lines; returns other messages. */
function serverLineErrors(error: ApiError, lines: LineDraft[]): { byLine: Record<number, LineProblems>; other: string[] } {
  const byLine: Record<number, LineProblems> = {};
  const other: string[] = [];
  for (const [path, messages] of Object.entries(error.fieldErrors)) {
    const match = /^lines\.(\d+)\.(\w+)$/.exec(path);
    const line = match ? lines[Number(match[1])] : undefined;
    if (line && match) {
      const name = (match[2] === "unit_id" ? "quantity" : match[2] === "product_sku_id" ? "quantity" : match[2]) as keyof LineProblems;
      byLine[line.key] = { ...byLine[line.key], [name]: messages[0] };
    } else {
      other.push(...messages);
    }
  }
  return { byLine, other };
}

function StockDocumentForm({ type }: { type: DocumentType }) {
  const router = useRouter();
  const canApprove = useCan("inventory.approve");
  const reasons = REASONS[type];
  const [reason, setReason] = useState(reasons[0].value);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [problems, setProblems] = useState<Record<number, LineProblems>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: number, patch: Partial<LineDraft>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setProblems((current) => ({ ...current, [key]: {} }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (lines.length === 0) {
      setMessage("Add at least one product.");
      return;
    }
    const found = Object.fromEntries(lines.map((line) => [line.key, lineProblems(type, line)]));
    setProblems(found);
    if (Object.values(found).some((p) => Object.keys(p).length > 0)) {
      setMessage("Check the highlighted lines.");
      return;
    }

    setSubmitting(true);
    try {
      const document = await createDocument(type, {
        reason,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        lines: lines.map((line) => toLineInput(type, line)),
      });
      router.push(`/inventory/documents/view?id=${document.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        const { byLine, other } = serverLineErrors(error, lines);
        setProblems(byLine);
        setMessage(other[0] ?? (Object.keys(byLine).length ? "Check the highlighted lines." : error.message));
      } else {
        setMessage(error instanceof Error ? error.message : "Something went wrong.");
      }
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <Panel title="Products" description={`${lines.length} ${lines.length === 1 ? "line" : "lines"}`}>
        <div className="grid gap-4">
          <SkuPicker onPick={(sku) => setLines((current) => [...current, newLine(sku)])} exclude={new Set(lines.map((l) => l.sku.id))} />
          {lines.length === 0 ? (
            <EmptyState icon={PackagePlus} title="No products yet">{COPY[type].empty}</EmptyState>
          ) : (
            <ul className="grid gap-3">
              {lines.map((line) => (
                <LineEditor key={line.key} type={type} line={line} problems={problems[line.key] ?? {}}
                  onChange={(patch) => update(line.key, patch)}
                  onRemove={() => setLines((current) => current.filter((l) => l.key !== line.key))} />
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel title="Document">
        <div className="grid gap-4">
          {message && <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>}
          <div className="grid gap-1.5">
            <Label htmlFor="reason">Reason</Label>
            <NativeSelect id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" maxLength={50} placeholder="Delivery receipt, memo no." value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {canApprove
              ? "Posting updates stock immediately and records a movement for every line."
              : "This is saved as a draft. Stock changes when a manager approves it."}
          </p>
          <div className="flex flex-col gap-2">
            <Button type="submit" disabled={submitting}>{submitting ? "Posting…" : canApprove ? COPY[type].submit : "Submit for approval"}</Button>
            <LinkButton variant="outline" href="/inventory">Cancel</LinkButton>
          </div>
        </div>
      </Panel>
    </form>
  );
}

function StockDocumentPage({ type }: { type: DocumentType }) {
  return (
    <div className="grid gap-6">
      <PageHeader title={COPY[type].title} description={COPY[type].description} />
      <RequirePermission permission="inventory.adjust" fallback={<p className="text-sm text-muted-foreground">You do not have permission to change stock.</p>}>
        <StockDocumentForm type={type} />
      </RequirePermission>
    </div>
  );
}

export const StockInPage = () => <StockDocumentPage type="stock_in" />;
export const StockOutPage = () => <StockDocumentPage type="stock_out" />;
export const StockCountPage = () => <StockDocumentPage type="adjustment" />;
