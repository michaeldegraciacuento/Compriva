<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Queries\ProductSales;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;

/** Sales and profit per category, with each category's share of net sales. */
class CategorySalesReport extends Report
{
    public function __construct(private readonly ProductSales $sales) {}

    public function key(): string
    {
        return 'category-sales';
    }

    public function title(): string
    {
        return 'Category sales';
    }

    public function description(): string
    {
        return 'Net sales, share of sales and gross profit per category.';
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $groups = [];
        foreach ($this->sales->between($filters) as $row) {
            $g = $groups[$row['category']] ??= ['products' => 0, 'sales' => '0', 'refunds' => '0', 'net' => '0', 'revenue' => '0', 'cogs' => '0', 'gross_profit' => '0'];
            $g['products']++;
            foreach (['sales', 'refunds', 'net', 'revenue', 'cogs', 'gross_profit'] as $key) {
                $g[$key] = Dec::add($g[$key], $row[$key]);
            }
            $groups[$row['category']] = $g;
        }
        uasort($groups, fn (array $a, array $b) => bccomp($b['net'], $a['net'], 8));

        $total = ['products' => 0, 'sales' => '0', 'refunds' => '0', 'net' => '0', 'revenue' => '0', 'cogs' => '0', 'gross_profit' => '0'];
        foreach ($groups as $g) {
            foreach ($total as $key => $value) {
                $total[$key] = $key === 'products' ? $value + $g[$key] : Dec::add($value, $g[$key]);
            }
        }
        $row = fn (string $label, array $g) => [
            'category' => $label,
            'products' => $g['products'],
            'sales' => Dec::money($g['sales']),
            'refunds' => Dec::money($g['refunds']),
            'net_sales' => Dec::money($g['net']),
            'share' => Dec::percent($g['net'], $total['net']),
            'cogs' => Dec::money($g['cogs']),
            'gross_profit' => Dec::money($g['gross_profit']),
            'margin' => Dec::percent($g['gross_profit'], $g['revenue']),
        ];

        return new ReportResult(
            $this->key(), $this->title(), $filters->rangeLabel(),
            [
                self::col('category', 'Category'),
                self::col('products', 'Products sold', 'int'),
                self::col('sales', 'Sales', 'money'),
                self::col('refunds', 'Refunds', 'money'),
                self::col('net_sales', 'Net sales', 'money'),
                self::col('share', 'Share', 'percent'),
                self::col('cogs', 'Cost of goods sold', 'money', true),
                self::col('gross_profit', 'Gross profit', 'money', true),
                self::col('margin', 'Margin', 'percent', true),
            ],
            array_map(fn (string $label) => $row($label, $groups[$label]), array_keys($groups)),
            $row('Total', $total),
        );
    }
}
