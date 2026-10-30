import { Receipt } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatTime } from "@/lib/format";

import type { SalesOverview } from "../types";

export function RecentTransactions({ items }: { items: SalesOverview["recent_transactions"] }) {
  return (
    <Panel title="Recent transactions" description="Latest sales across all terminals" flush data-testid="recent-transactions">
      {items.length === 0 ? (
        <EmptyState icon={Receipt} title="No transactions yet">Completed sales appear here as they sync from the terminals.</EmptyState>
      ) : (
        <Table className="numeric">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Receipt</TableHead>
              <TableHead className="hidden sm:table-cell">Time</TableHead>
              <TableHead className="hidden md:table-cell">Cashier</TableHead>
              <TableHead className="hidden lg:table-cell">Items</TableHead>
              <TableHead className="hidden sm:table-cell">Payment</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="pr-5 text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="pl-5 font-medium">{t.receipt_number}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{formatTime(t.occurred_at)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {t.cashier_name}
                  <span className="text-muted-foreground"> · {t.terminal_code}</span>
                </TableCell>
                <TableCell className="hidden lg:table-cell">{t.item_count}</TableCell>
                <TableCell className="hidden sm:table-cell">{t.payment_method}</TableCell>
                <TableCell className={`text-right font-medium ${t.status === "voided" ? "text-muted-foreground line-through" : ""}`}>
                  {formatMoney(t.total)}
                </TableCell>
                <TableCell className="pr-5 text-right">
                  {t.status === "voided" ? <StatusBadge tone="neutral">Voided</StatusBadge> : <StatusBadge tone="success">Completed</StatusBadge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
