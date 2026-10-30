<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Batches with stock left that have expired or expire within N days, earliest first. */
class ExpiringProductsReport extends Report
{
    public function key(): string
    {
        return 'expiring-products';
    }

    public function title(): string
    {
        return 'Expiring products';
    }

    public function description(): string
    {
        return 'Batches already expired or expiring soon, with the stock and its cost at risk.';
    }

    public function filters(): array
    {
        return ['days'];
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $today = $filters->today();
        $batches = DB::table('stock_batches')
            ->join('product_skus', 'product_skus.id', '=', 'stock_batches.product_sku_id')
            ->join('units', 'units.id', '=', 'product_skus.base_unit_id')
            ->where('stock_batches.remaining_quantity', '>', 0)
            ->whereNotNull('stock_batches.expiry_date')
            ->where('stock_batches.expiry_date', '<=', $today->copy()->addDays($filters->days)->toDateString())
            ->orderBy('stock_batches.expiry_date')->orderBy('product_skus.name')
            ->get(['product_skus.code', 'product_skus.name', 'units.code AS unit', 'stock_batches.batch_number', 'stock_batches.expiry_date',
                'stock_batches.remaining_quantity', 'stock_batches.unit_cost']);

        $value = '0';
        $expired = 0;
        $rows = $batches->map(function ($b) use ($today, &$value, &$expired) {
            $daysLeft = (int) $today->diffInDays(Carbon::parse($b->expiry_date, $today->timezone), false);
            $cost = bcmul($b->remaining_quantity, $b->unit_cost, 8);
            $value = Dec::add($value, $cost);
            $expired += $daysLeft < 0 ? 1 : 0;

            return [
                'code' => $b->code,
                'product' => $b->name,
                'batch' => $b->batch_number,
                'expiry_date' => (string) $b->expiry_date,
                'days_left' => $daysLeft,
                'status' => $daysLeft < 0 ? 'Expired' : ($daysLeft === 0 ? 'Expires today' : 'Expiring'),
                'remaining' => Dec::qty($b->remaining_quantity),
                'unit' => $b->unit,
                'cost_value' => Dec::money($cost),
            ];
        })->all();

        return new ReportResult(
            $this->key(), $this->title(), "Expired, or expiring within {$filters->days} days of ".$today->format('j M Y'),
            [
                self::col('code', 'SKU'),
                self::col('product', 'Product'),
                self::col('batch', 'Batch'),
                self::col('expiry_date', 'Expiry', 'date'),
                self::col('days_left', 'Days left', 'int'),
                self::col('status', 'Status'),
                self::col('remaining', 'Remaining', 'qty'),
                self::col('unit', 'Unit'),
                self::col('cost_value', 'Cost at risk', 'money', true),
            ],
            $rows,
            ['code' => 'Total', 'product' => count($rows).' batches', 'batch' => null, 'expiry_date' => null, 'days_left' => null,
                'status' => "{$expired} expired", 'remaining' => null, 'unit' => null, 'cost_value' => Dec::money($value)],
            ['Sell expiring stock first (FEFO); remove expired stock with a stock-out (reason: expiry).'],
        );
    }
}
