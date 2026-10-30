<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Queries\DailySales;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;

/** Revenue without VAT, cost of goods sold and gross profit per period. */
class GrossProfitReport extends Report
{
    public function __construct(private readonly DailySales $daily) {}

    public function key(): string
    {
        return 'gross-profit';
    }

    public function title(): string
    {
        return 'Gross profit';
    }

    public function description(): string
    {
        return 'Revenue without VAT, cost of goods sold, gross profit and margin per day, week or month.';
    }

    public function permission(): string
    {
        return 'reports.view_profit';
    }

    public function filters(): array
    {
        return ['range', 'group'];
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $rows = [];
        $revenue = $cogs = '0';
        foreach (DailySales::group($this->daily->between($filters), $filters->group) as $bucket) {
            $v = $bucket['values'];
            $rows[] = self::row($bucket['label'], $v['revenue'], $v['cogs']);
            $revenue = Dec::add($revenue, $v['revenue']);
            $cogs = Dec::add($cogs, $v['cogs']);
        }

        return new ReportResult(
            $this->key(), $this->title(), $filters->rangeLabel(),
            [
                self::col('period', 'Period'),
                self::col('revenue', 'Revenue (without VAT)', 'money'),
                self::col('cogs', 'Cost of goods sold', 'money'),
                self::col('gross_profit', 'Gross profit', 'money'),
                self::col('margin', 'Margin', 'percent'),
            ],
            $rows,
            self::row('Total', $revenue, $cogs),
            ['Revenue = sales minus refunds, without VAT. Cost of goods sold uses the cost recorded on each sale line; goods returned to stock are taken back out.'],
        );
    }

    private static function row(string $label, string $revenue, string $cogs): array
    {
        $profit = Dec::sub($revenue, $cogs);

        return [
            'period' => $label,
            'revenue' => Dec::money($revenue),
            'cogs' => Dec::money($cogs),
            'gross_profit' => Dec::money($profit),
            'margin' => Dec::percent($profit, $revenue),
        ];
    }
}
