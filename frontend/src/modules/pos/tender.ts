import { cents, format, min, sum, ZERO } from "./fixed-point";

/**
 * Applies payments to a total and works out the change, like the server's
 * TenderCalculator (backend/app/Domain/Sales/Pricing/TenderCalculator.php):
 * only cash may be over-tendered, GCash and Maya pay exact amounts, and the
 * change comes out of the cash (last cash tender first).
 */

export interface Tender {
  allowsChange: boolean;
  amount: string;
}

export interface TenderResult {
  paid: string;
  /** Still to pay; "0.00" once the total is covered. */
  due: string;
  change: string;
  /** Why the payment cannot be completed yet, or null when it can. */
  problem: string | null;
}

export function applyTenders(grandTotal: string, tenders: Tender[]): TenderResult {
  const total = cents(grandTotal);
  const amounts = tenders.map((t) => cents(t.amount));
  const paid = sum(amounts);
  const exact = sum(amounts.filter((_, i) => !tenders[i].allowsChange));
  const due = paid >= total ? ZERO : total - paid;
  const change = paid > total ? paid - total : ZERO;

  let problem: string | null = null;
  if (amounts.some((a) => a <= ZERO)) problem = "Enter an amount greater than zero.";
  else if (exact > total) problem = "GCash and Maya payments cannot be more than the amount due; only cash gives change.";
  else if (due > ZERO) problem = `₱${format(due)} is still due.`;
  else {
    // Every tender must keep part of the sale once the change is taken out of the cash.
    let left = change;
    const kept = [...amounts];
    for (let i = tenders.length - 1; i >= 0 && left > ZERO; i--) {
      if (!tenders[i].allowsChange) continue;
      const take = min(left, kept[i]);
      kept[i] -= take;
      left -= take;
    }
    if (kept.some((amount) => amount <= ZERO)) problem = "A payment is not needed: the others already cover the total.";
  }

  return { paid: format(paid), due: format(due), change: format(change), problem };
}
