<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Queries\ProductSales;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;

/** Cost of goods sold per product: net quantity, average cost per base unit and total cost. */
class CostOfGoodsSoldReport extends Report
{
    public function __construct(private readonly ProductSales $sales) {}

    public function key(): string
    {
        return 'cogs';
    }

    public function title(): string
    {
        return 'Cost of goods sold';
    }

    public function description(): string
    {
        return 'What the goods sold cost the store, per product, with the average cost per unit.';
    }

    public function permission(): string
    {
        return 'reports.view_profit';
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $rows = $this->sales->between($filters);
        usort($rows, fn (array $a, array $b) => bccomp($b['cogs'], $a['cogs'], 8));
        $total = Dec::add(...array_column($rows, 'cogs'));

        return new ReportResult(
            $this->key(), $this->title(), $filters->rangeLabel(),
            [
                self::col('code', 'SKU'),
                self::col('product', 'Product'),
                self::col('category', 'Category'),
                self::col('quantity', 'Net qty sold', 'qty'),
                self::col('unit', 'Unit'),
                self::col('average_cost', 'Average cost', 'money'),
                self::col('cogs', 'Cost of goods sold', 'money'),
                self::col('share', 'Share', 'percent'),
            ],
            array_map(function (array $r) use ($total) {
                $quantity = Dec::sub($r['qty'], $r['returned_qty']);

                return [
                    'code' => $r['code'],
                    'product' => $r['name'],
                    'category' => $r['category'],
                    'quantity' => Dec::qty($quantity),
                    'unit' => $r['unit'],
                    'average_cost' => Dec::div($r['cogs'], $quantity, 4),
                    'cogs' => Dec::money($r['cogs']),
                    'share' => Dec::percent($r['cogs'], $total),
                ];
            }, $rows),
            ['code' => 'Total', 'product' => null, 'category' => null, 'quantity' => null, 'unit' => null, 'average_cost' => null, 'cogs' => Dec::money($total), 'share' => $rows === [] ? null : '100.0'],
            ['Cost is the weighted average cost (or batch cost) recorded on each sale line. Goods returned to stock are taken back out.'],
        );
    }
}
