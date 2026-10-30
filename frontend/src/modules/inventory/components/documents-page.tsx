"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";

import { fetchDocuments } from "../api";
import { DOCUMENT_LABELS, type DocumentStatus, type DocumentType } from "../types";

export const documentStatusBadge = (status: DocumentStatus) =>
  status === "posted" ? <StatusBadge tone="success">Posted</StatusBadge> : <StatusBadge tone="warning">Awaiting approval</StatusBadge>;

type Filters = { type?: DocumentType; status?: DocumentStatus; q?: string; page: number };

/** Stock-in, stock-out and count documents, newest first. */
export function DocumentsPage() {
  const [filters, setFilters] = useState<Filters>({ page: 1 });
  const documents = useApiQuery(["documents", filters], () => fetchDocuments(filters));
  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, page: 1, ...patch }));

  return (
    <div className="grid gap-6">
      <PageHeader title="Stock documents" description="Every stock change is a numbered document. Drafts wait for a manager's approval." />
      <Panel title="Documents" flush>
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row">
          <SearchInput label="Search documents" placeholder="Number or reference" value={filters.q ?? ""} onChange={(q) => update({ q: q || undefined })} />
          <NativeSelect aria-label="Type" value={filters.type ?? ""} onChange={(e) => update({ type: (e.target.value || undefined) as DocumentType })} className="sm:w-40">
            <option value="">All types</option>
            {Object.entries(DOCUMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Status" value={filters.status ?? ""} onChange={(e) => update({ status: (e.target.value || undefined) as DocumentStatus })} className="sm:w-48">
            <option value="">Any status</option>
            <option value="draft">Awaiting approval</option>
            <option value="posted">Posted</option>
          </NativeSelect>
        </div>
        {documents.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{documents.error.message}</AlertDescription></Alert>
        ) : documents.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : documents.data?.data.length === 0 ? (
          <EmptyState icon={FileText} title="No documents">Stock-in, stock-out and count documents appear here.</EmptyState>
        ) : (
          <Table className="numeric" aria-busy={documents.fetching}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Reason</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Lines</TableHead>
                <TableHead className="hidden lg:table-cell">By</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="pr-5 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.data?.data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="pl-5 font-medium">
                    <Link href={`/inventory/documents/view?id=${d.id}`} className="hover:underline">{d.number}</Link>
                    {d.reference && <span className="block text-xs text-muted-foreground">{d.reference}</span>}
                  </TableCell>
                  <TableCell>{DOCUMENT_LABELS[d.type]}</TableCell>
                  <TableCell className="hidden md:table-cell">{d.reason_label}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">{d.lines_count ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{d.created_by?.name}</TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(d.posted_at ?? d.created_at)} <span className="text-muted-foreground">{formatTime(d.posted_at ?? d.created_at)}</span></TableCell>
                  <TableCell className="pr-5 text-right">{documentStatusBadge(d.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination meta={documents.data?.meta} onPage={(page) => setFilters((current) => ({ ...current, page }))} />
      </Panel>
    </div>
  );
}
