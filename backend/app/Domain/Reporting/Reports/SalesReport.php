<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Queries\DailySales;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;

/** Daily, weekly or monthly sales, with cost and profit for users who may see them. */
class SalesReport extends Report
{
    public function __construct(private readonly DailySales $daily) {}

    public function key(): string
    {
        return 'sales';
    }

    public function title(): string
    {
        return 'Sales by period';
    }

    public function description(): string
    {
        return 'Daily, weekly or monthly transactions, sales, discounts, VAT, refunds and gross profit.';
    }

    public function filters(): array
    {
        return ['range', 'group'];
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $buckets = DailySales::group($this->daily->between($filters), $filters->group);
        $keys = ['transactions', 'gross', 'discounts', 'net', 'vat', 'refunds', 'net_after_refunds', 'revenue', 'cogs', 'gross_profit'];

        $rows = [];
        $sum = array_fill_keys($keys, '0');
        $sum['transactions'] = 0;
        foreach ($buckets as $bucket) {
            $v = $bucket['values'];
            $rows[] = self::row($bucket['label'], $v);
            foreach ($keys as $key) {
                $sum[$key] = $key === 'transactions' ? $sum[$key] + $v[$key] : Dec::add($sum[$key], $v[$key]);
            }
        }

        $label = ['day' => 'Daily', 'week' => 'Weekly', 'month' => 'Monthly'][$filters->group] ?? 'Daily';

        return new ReportResult(
            $this->key(), "{$label} sales", $filters->rangeLabel(),
            [
                self::col('period', ucfirst($filters->group === 'day' ? 'date' : $filters->group)),
                self::col('transactions', 'Transactions', 'int'),
                self::col('gross_sales', 'Gross sales', 'money'),
                self::col('discounts', 'Discounts', 'money'),
                self::col('net_sales', 'Net sales', 'money'),
                self::col('refunds', 'Refunds', 'money'),
                self::col('net_after_refunds', 'Net after refunds', 'money'),
                self::col('vat', 'VAT', 'money'),
                self::col('average_sale', 'Average sale', 'money'),
                self::col('cogs', 'Cost of goods sold', 'money', true),
                self::col('gross_profit', 'Gross profit', 'money', true),
                self::col('margin', 'Margin', 'percent', true),
            ],
            $rows,
            self::row('Total', $sum),
            ['Voided sales are excluded. Gross profit = sales and refunds without VAT, minus the cost of goods sold.'],
        );
    }

    /** @param array<string, string|int> $v */
    private static function row(string $label, array $v): array
    {
        return [
            'period' => $label,
            'transactions' => $v['transactions'],
            'gross_sales' => Dec::money($v['gross']),
            'discounts' => Dec::money($v['discounts']),
            'net_sales' => Dec::money($v['net']),
            'refunds' => Dec::money($v['refunds']),
            'net_after_refunds' => Dec::money($v['net_after_refunds']),
            'vat' => Dec::money($v['vat']),
            'average_sale' => Dec::div($v['net'], $v['transactions']),
            'cogs' => Dec::money($v['cogs']),
            'gross_profit' => Dec::money($v['gross_profit']),
            'margin' => Dec::percent($v['gross_profit'], $v['revenue']),
        ];
    }
}
