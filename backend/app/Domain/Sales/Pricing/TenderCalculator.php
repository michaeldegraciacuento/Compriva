<?php

namespace App\Domain\Sales\Pricing;

use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;

/**
 * Applies payments (tenders) to a sale total and works out the change.
 *
 * - Only methods that allow change (cash) may be over-tendered. GCash and Maya
 *   pay an exact amount, which together may not exceed the total.
 * - Non-cash tenders are applied first; cash covers the rest, and the change
 *   comes out of the cash tenders (the last one first).
 * - Every tender must keep a positive amount; extra tenders are refused.
 *
 * Mirrored by frontend/src/modules/pos/tender.ts.
 */
final class TenderCalculator
{
    /**
     * @param  list<array{allows_change: bool, tendered: string}>  $tenders
     * @return array{tenders: list<array{amount: string, tendered: string, change: string}>, amount_paid: string, change_due: string}
     */
    public function apply(string $grandTotal, array $tenders): array
    {
        $total = FixedPoint::cents($grandTotal);
        $tendered = array_map(fn (array $t) => FixedPoint::cents($t['tendered']), $tenders);

        foreach ($tendered as $i => $amount) {
            if ($amount <= 0) {
                $this->fail("payments.{$i}.amount", 'Enter an amount greater than zero.');
            }
        }
        if ($total === 0 && $tenders !== []) {
            $this->fail('payments', 'Nothing to pay: remove the payments.');
        }

        $exact = 0;
        foreach ($tenders as $i => $t) {
            if (! $t['allows_change']) {
                $exact += $tendered[$i];
            }
        }
        if ($exact > $total) {
            $this->fail('payments', 'GCash and Maya payments cannot be more than the amount due; only cash gives change.');
        }

        $paid = array_sum($tendered);
        if ($paid < $total) {
            $this->fail('payments', sprintf('₱%s is still due.', FixedPoint::format($total - $paid)));
        }

        // Change comes out of the cash tenders, last one first.
        $change = $paid - $total;
        $changes = array_fill(0, count($tenders), 0);
        $left = $change;
        for ($i = count($tenders) - 1; $i >= 0 && $left > 0; $i--) {
            if ($tenders[$i]['allows_change']) {
                $changes[$i] = min($left, $tendered[$i]);
                $left -= $changes[$i];
            }
        }

        $out = [];
        foreach ($tenders as $i => $t) {
            $amount = $tendered[$i] - $changes[$i];
            if ($amount <= 0) {
                $this->fail("payments.{$i}.amount", 'This payment is not needed: the others already cover the total.');
            }
            $out[] = ['amount' => FixedPoint::format($amount), 'tendered' => FixedPoint::format($tendered[$i]), 'change' => FixedPoint::format($changes[$i])];
        }

        return ['tenders' => $out, 'amount_paid' => FixedPoint::format($paid), 'change_due' => FixedPoint::format($change)];
    }

    private function fail(string $field, string $message): never
    {
        throw new BusinessException($message, ErrorCode::ValidationFailed, 422, ['fields' => [$field => [$message]]]);
    }
}
