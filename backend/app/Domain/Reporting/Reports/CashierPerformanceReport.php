<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;
use Illuminate\Support\Facades\DB;

/** Per cashier: shifts, sales, average sale, items, voids, returns and cash variance. */
class CashierPerformanceReport extends Report
{
    public function key(): string
    {
        return 'cashier-performance';
    }

    public function title(): string
    {
        return 'Cashier performance';
    }

    public function description(): string
    {
        return 'Transactions, sales, average sale, voids, refunds and cash over/short per cashier.';
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $range = [$filters->fromDate(), $filters->toDate()];

        $sales = DB::table('sales')->whereBetween('business_date', $range)->groupBy('cashier_id')
            ->selectRaw("cashier_id, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS transactions,
                SUM(CASE WHEN status = 'completed' THEN grand_total ELSE 0 END) AS total,
                SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END) AS voids")
            ->get()->keyBy('cashier_id');
        $lines = DB::table('sale_items')->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.status', 'completed')->whereBetween('sales.business_date', $range)
            ->groupBy('sales.cashier_id')->selectRaw('sales.cashier_id, COUNT(*) AS line_count')->pluck('line_count', 'cashier_id');
        $refunds = DB::table('sale_returns')->whereBetween('business_date', $range)
            ->groupBy('processed_by')->selectRaw('processed_by, SUM(total_refund) AS total')->pluck('total', 'processed_by');
        $shifts = DB::table('cashier_shifts')->where('opened_at', '>=', $filters->fromUtc())->where('opened_at', '<', $filters->toUtc())
            ->groupBy('cashier_id')
            ->selectRaw("cashier_id, COUNT(*) AS shifts, SUM(CASE WHEN status = 'closed' THEN cash_variance ELSE 0 END) AS variance,
                SUM(CASE WHEN status = 'closed' AND cash_variance <> 0 THEN 1 ELSE 0 END) AS off_shifts")
            ->get()->keyBy('cashier_id');

        $ids = $sales->keys()->merge($refunds->keys())->merge($shifts->keys())->unique();
        $names = DB::table('users')->whereIn('id', $ids)->pluck('name', 'id');

        $sum = ['shifts' => 0, 'transactions' => 0, 'lines' => 0, 'voids' => 0, 'total' => '0', 'refunds' => '0', 'variance' => '0'];
        $rows = $ids->map(function (string $id) use ($sales, $lines, $refunds, $shifts, $names, &$sum) {
            $s = $sales->get($id);
            $sh = $shifts->get($id);
            $row = [
                'shifts' => (int) ($sh->shifts ?? 0),
                'transactions' => (int) ($s->transactions ?? 0),
                'lines' => (int) ($lines[$id] ?? 0),
                'voids' => (int) ($s->voids ?? 0),
                'total' => Dec::of($s->total ?? 0),
                'refunds' => Dec::of($refunds[$id] ?? 0),
                'variance' => Dec::of($sh->variance ?? 0),
            ];
            foreach ($sum as $key => $value) {
                $sum[$key] = is_int($value) ? $value + $row[$key] : Dec::add($value, $row[$key]);
            }

            return self::row($names[$id] ?? 'Unknown user', $row, (int) ($sh->off_shifts ?? 0));
        })->sort(fn (array $a, array $b) => bccomp($b['sales'], $a['sales'], 2))->values()->all();

        return new ReportResult(
            $this->key(), $this->title(), $filters->rangeLabel(),
            [
                self::col('cashier', 'Cashier'),
                self::col('shifts', 'Shifts', 'int'),
                self::col('transactions', 'Transactions', 'int'),
                self::col('sales', 'Sales', 'money'),
                self::col('average_sale', 'Average sale', 'money'),
                self::col('items_per_sale', 'Lines per sale', 'qty'),
                self::col('voids', 'Voids', 'int'),
                self::col('refunds', 'Refunds processed', 'money'),
                self::col('cash_variance', 'Cash over/short', 'money'),
                self::col('shifts_off', 'Shifts not balanced', 'int'),
            ],
            $rows,
            self::row('Total', $sum, array_sum(array_column($rows, 'shifts_off'))),
            ['Cash over/short is the counted minus the expected cash of shifts closed in the period (negative = short).'],
        );
    }

    /** @param array<string, int|string> $v */
    private static function row(string $name, array $v, int $offShifts): array
    {
        return [
            'cashier' => $name,
            'shifts' => $v['shifts'],
            'transactions' => $v['transactions'],
            'sales' => Dec::money($v['total']),
            'average_sale' => Dec::div($v['total'], $v['transactions']),
            'items_per_sale' => Dec::div($v['lines'], $v['transactions'], 1),
            'voids' => $v['voids'],
            'refunds' => Dec::money($v['refunds']),
            'cash_variance' => Dec::money($v['variance']),
            'shifts_off' => $offShifts,
        ];
    }
}
