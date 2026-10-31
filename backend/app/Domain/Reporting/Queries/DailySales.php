<?php

namespace App\Domain\Reporting\Queries;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\ReportFilters;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Sales figures per business day, the basis of the period, profit and COGS
 * reports. Definitions (docs/README.md):
 *
 *   net sales   = Σ grand total of completed sales (voided sales excluded)
 *   refunds     = Σ returns processed that day
 *   revenue     = (net sales − sales VAT) − (refunds − refund VAT)       VAT-exclusive
 *   COGS        = Σ line cost (unit cost × quantity) − cost of goods returned to stock
 *   gross profit = revenue − COGS
 */
class DailySales
{
    /** @return array<string, array<string, string|int>> keyed by Y-m-d, every day of the range */
    public function between(ReportFilters $filters): array
    {
        $range = [$filters->fromDate(), $filters->toDate()];

        $sales = DB::table('sales')->where('status', 'completed')->whereBetween('business_date', $range)
            ->groupBy('business_date')
            ->selectRaw('business_date AS day, COUNT(*) AS transactions, SUM(gross_amount) AS gross, SUM(discount_total) AS discounts, SUM(grand_total) AS net, SUM(vat_amount) AS vat')
            ->get()->keyBy(fn ($r) => (string) $r->day);

        $cogs = DB::table('sale_items')->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.status', 'completed')->whereBetween('sales.business_date', $range)
            ->groupBy('sales.business_date')
            ->selectRaw('sales.business_date AS day, SUM(sale_items.unit_cost * sale_items.quantity) AS cogs')
            ->pluck('cogs', 'day');

        $refunds = DB::table('sale_returns')->whereBetween('business_date', $range)
            ->groupBy('business_date')
            ->selectRaw('business_date AS day, SUM(total_refund) AS refunds, SUM(vat_amount) AS refund_vat')
            ->get()->keyBy(fn ($r) => (string) $r->day);

        $returnedCost = DB::table('sale_return_items')
            ->join('sale_returns', 'sale_returns.id', '=', 'sale_return_items.sale_return_id')
            ->join('sale_items', 'sale_items.id', '=', 'sale_return_items.sale_item_id')
            ->where('sale_return_items.restock', true)->whereBetween('sale_returns.business_date', $range)
            ->groupBy('sale_returns.business_date')
            ->selectRaw('sale_returns.business_date AS day, SUM(sale_return_items.quantity * sale_items.unit_cost) AS cost')
            ->pluck('cost', 'day');

        $days = [];
        for ($day = $filters->from->copy(); $day->lte($filters->to); $day->addDay()) {
            $key = $day->toDateString();
            $s = $sales->get($key);
            $r = $refunds->get($key);
            $netSales = Dec::of($s->net ?? 0);
            $refundTotal = Dec::of($r->refunds ?? 0);
            $revenue = Dec::sub(Dec::sub($netSales, $s->vat ?? 0), Dec::sub($refundTotal, $r->refund_vat ?? 0));
            $dayCogs = Dec::sub($cogs[$key] ?? 0, $returnedCost[$key] ?? 0);

            $days[$key] = [
                'transactions' => (int) ($s->transactions ?? 0),
                'gross' => Dec::of($s->gross ?? 0),
                'discounts' => Dec::of($s->discounts ?? 0),
                'net' => $netSales,
                'vat' => Dec::sub($s->vat ?? 0, $r->refund_vat ?? 0),
                'refunds' => $refundTotal,
                'net_after_refunds' => Dec::sub($netSales, $refundTotal),
                'revenue' => $revenue,
                'cogs' => $dayCogs,
                'gross_profit' => Dec::sub($revenue, $dayCogs),
            ];
        }

        return $days;
    }

    /**
     * Folds days into weeks (Monday start) or months.
     *
     * @param  array<string, array<string, string|int>>  $days
     * @return array<string, array{label: string, values: array<string, string|int>}>
     */
    public static function group(array $days, string $group): array
    {
        $buckets = [];
        foreach ($days as $date => $values) {
            $day = Carbon::parse($date);
            [$key, $label] = match ($group) {
                'week' => [$day->copy()->startOfWeek()->toDateString(), 'Week of '.$day->copy()->startOfWeek()->format('j M Y')],
                'month' => [$day->format('Y-m'), $day->format('F Y')],
                default => [$date, $day->format('D, j M Y')],
            };
            if (! isset($buckets[$key])) {
                $buckets[$key] = ['label' => $label, 'values' => $values];

                continue;
            }
            foreach ($values as $name => $value) {
                $buckets[$key]['values'][$name] = is_int($value) ? $buckets[$key]['values'][$name] + $value : Dec::add($buckets[$key]['values'][$name], $value);
            }
        }

        return $buckets;
    }
}
