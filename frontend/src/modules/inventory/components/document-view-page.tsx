"use client";

import { Check, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { LinkButton } from "@/components/link-button";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatQuantity, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { notify } from "@/lib/notify";
import { useCan, useSession } from "@/modules/auth/hooks";

import { approveDocument, fetchDocument, rejectDocument } from "../api";
import { DOCUMENT_LABELS, type StockDocument } from "../types";
import { documentStatusBadge } from "./documents-page";

type Line = NonNullable<StockDocument["lines"]>[number];

/** Signed change in base units: "+24", "−3". */
function change(line: Line): string {
  const n = Number(line.quantity_change);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatQuantity(String(Math.abs(n)))}`;
}

function entered(document: StockDocument, line: Line): string {
  if (document.type === "adjustment") {
    return `${formatQuantity(line.counted_quantity ?? "0")} counted · ${formatQuantity(line.system_quantity)} in system`;
  }
  return line.quantity && line.unit ? formatQuantity(line.quantity, line.unit.code) : "—";
}

function DocumentView({ id }: { id: string }) {
  const router = useRouter();
  const session = useSession();
  const canApprove = useCan("inventory.approve");
  const doc = useApiQuery(["document", id], () => fetchDocument(id));

  if (doc.error) return <Alert variant="destructive"><AlertDescription>{doc.error.message}</AlertDescription></Alert>;
  if (!doc.data) return <Skeleton className="h-96 w-full" />;

  const d = doc.data;
  const draft = d.status === "draft";
  const isAuthor = d.created_by?.id === session?.user.id;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`${DOCUMENT_LABELS[d.type]} ${d.number}`}
        description={<span className="flex flex-wrap items-center gap-2">{documentStatusBadge(d.status)} {d.reason_label}</span>}
        actions={draft && (
          <>
            {(canApprove || isAuthor) && (
              <ConfirmDialog
                trigger={<Button variant="outline"><X aria-hidden /> {isAuthor && !canApprove ? "Discard draft" : "Reject"}</Button>}
                title="Discard this draft?"
                description="The draft is deleted. Stock was never changed by it."
                confirmLabel="Discard" destructive
                onConfirm={async () => { await rejectDocument(d.id); notify.success("Document discarded", d.number); router.push("/inventory/documents"); }}
              />
            )}
            {canApprove && (
              <ConfirmDialog
                trigger={<Button><Check aria-hidden /> Approve & post</Button>}
                title={`Post ${d.number}?`}
                description="Stock levels change now and a movement is recorded for every line. Posted documents cannot be edited."
                confirmLabel="Approve & post"
                onConfirm={async () => { await approveDocument(d.id); notify.success("Approved and posted", `${d.number}: stock updated.`); await doc.reload(); }}
              />
            )}
          </>
        )}
      />

      {draft && !canApprove && (
        <Alert><AlertDescription>Waiting for a manager to approve. Stock has not changed yet.</AlertDescription></Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <Panel title="Lines" flush>
          <Table className="numeric">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Product</TableHead>
                <TableHead className="hidden sm:table-cell">Entered</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="hidden pr-5 text-right md:table-cell">Unit cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.lines?.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="max-w-0 pl-5 sm:max-w-none">
                    <span className="block truncate font-medium">{line.sku.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {line.sku.code}
                      {(line.batch?.batch_number ?? line.batch_number) && ` · batch ${line.batch?.batch_number ?? line.batch_number}`}
                      {(line.batch?.expiry_date ?? line.expiry_date) && ` · exp ${formatDate((line.batch?.expiry_date ?? line.expiry_date)!)}`}
                    </span>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">{entered(d, line)}</TableCell>
                  <TableCell className={`text-right font-medium whitespace-nowrap ${Number(line.quantity_change) < 0 ? "text-danger" : ""}`}>
                    {change(line)}
                  </TableCell>
                  <TableCell className="hidden pr-5 text-right md:table-cell">{formatMoney(line.unit_cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>

        <Panel title="Details">
          <dl className="grid gap-3 text-sm">
            {[
              ["Reference", d.reference ?? "—"],
              ["Created by", `${d.created_by?.name ?? "—"} · ${formatDate(d.created_at)} ${formatTime(d.created_at)}`],
              ["Approved by", d.approved_by ? d.approved_by.name : draft ? "Not yet" : "—"],
              ["Posted", d.posted_at ? `${formatDate(d.posted_at)} ${formatTime(d.posted_at)}` : "Not yet"],
              ["Notes", d.notes ?? "—"],
            ].map(([term, value]) => (
              <div key={term} className="grid gap-0.5">
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {!draft && (
            <LinkButton size="sm" variant="outline" className="mt-4" href={`/inventory/movements?document_id=${d.id}`}>View movements</LinkButton>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function DocumentViewPage() {
  const id = useSearchParams().get("id");
  if (!id) return <Alert variant="destructive"><AlertDescription>No document selected.</AlertDescription></Alert>;
  return <DocumentView key={id} id={id} />;
}
