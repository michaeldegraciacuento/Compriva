<?php

namespace App\Domain\Cashiering\Queries;

use App\Domain\Cashiering\Enums\CashMovementType;
use App\Domain\Sales\Enums\SaleStatus;
use App\Models\CashierShift;
use App\Models\CashMovement;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\Sale;

/**
 * Takings of one shift and the cash that should be in the drawer:
 *
 *   expected cash = opening float + cash sales − cash refunds + cash in − cash out − cash drops
 *
 * Cash sales count what the sale kept (tendered − change). Voided sales are
 * excluded: their money went back to the customer.
 */
class ShiftSummary
{
    private const SCALE = 4;

    /** @return array<string, mixed> */
    public function for(CashierShift $shift): array
    {
        $completed = Sale::where('cashier_shift_id', $shift->id)->where('status', SaleStatus::Completed);

        $payments = Payment::query()
            ->whereIn('sale_id', (clone $completed)->select('id'))
            ->selectRaw('method_code, COUNT(*) as count, SUM(amount) as total')
            ->groupBy('method_code')
            ->get()
            ->mapWithKeys(fn ($row) => [$row->method_code => ['count' => (int) $row->count, 'total' => $this->dec($row->total)]]);

        $refunds = Refund::query()
            ->whereHas('saleReturn', fn ($q) => $q->where('cashier_shift_id', $shift->id))
            ->selectRaw('method_code, SUM(amount) as total')
            ->groupBy('method_code')
            ->pluck('total', 'method_code')
            ->map(fn ($total) => $this->dec($total));

        $movements = CashMovement::where('cashier_shift_id', $shift->id)
            ->selectRaw('type, SUM(amount) as total')
            ->groupBy('type')
            ->pluck('total', 'type')
            ->map(fn ($total) => $this->dec($total));

        $cashIn = $movements[CashMovementType::CashIn->value] ?? '0.0000';
        $cashOut = bcadd($movements[CashMovementType::CashOut->value] ?? '0', $movements[CashMovementType::CashDrop->value] ?? '0', self::SCALE);
        $cashSales = $payments['cash']['total'] ?? '0.0000';
        $cashRefunds = $refunds['cash'] ?? '0.0000';

        $expected = bcsub(bcadd(bcsub(bcadd($shift->opening_float, $cashSales, self::SCALE), $cashRefunds, self::SCALE), $cashIn, self::SCALE), $cashOut, self::SCALE);

        return [
            'sales_count' => (clone $completed)->count(),
            'voided_count' => Sale::where('cashier_shift_id', $shift->id)->where('status', SaleStatus::Voided)->count(),
            'sales_total' => $this->dec((clone $completed)->sum('grand_total')),
            'payments' => $payments,
            'refunds' => $refunds,
            'refunds_total' => $this->dec($refunds->reduce(fn ($carry, $total) => bcadd($carry, $total, self::SCALE), '0')),
            'opening_float' => $shift->opening_float,
            'cash_sales' => $cashSales,
            'cash_refunds' => $cashRefunds,
            'cash_in' => $cashIn,
            'cash_out' => $cashOut,
            'expected_cash' => $expected,
        ];
    }

    private function dec(mixed $value): string
    {
        return bcadd((string) ($value ?? '0'), '0', self::SCALE);
    }
}
