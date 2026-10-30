<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Queries\ProductSales;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;

/** What sold, best sellers first: quantity, sales, returns and profit per product. */
class ProductSalesReport extends Report
{
    public function __construct(private readonly ProductSales $sales) {}

    public function key(): string
    {
        return 'product-sales';
    }

    public function title(): string
    {
        return 'Product sales';
    }

    public function description(): string
    {
        return 'Quantity sold, sales, returns and gross profit per product, best sellers first.';
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $rows = $this->sales->between($filters);
        $sum = ['sales' => '0', 'refunds' => '0', 'net' => '0', 'revenue' => '0', 'cogs' => '0', 'gross_profit' => '0'];
        foreach ($rows as $row) {
            foreach ($sum as $key => $value) {
                $sum[$key] = Dec::add($value, $row[$key]);
            }
        }

        return new ReportResult(
            $this->key(), $this->title(), $filters->rangeLabel(),
            [
                self::col('code', 'SKU'),
                self::col('product', 'Product'),
                self::col('category', 'Category'),
                self::col('quantity', 'Qty sold', 'qty'),
                self::col('unit', 'Unit'),
                self::col('returned', 'Qty returned', 'qty'),
                self::col('sales', 'Sales', 'money'),
                self::col('refunds', 'Refunds', 'money'),
                self::col('net_sales', 'Net sales', 'money'),
                self::col('cogs', 'Cost of goods sold', 'money', true),
                self::col('gross_profit', 'Gross profit', 'money', true),
                self::col('margin', 'Margin', 'percent', true),
            ],
            array_map(fn (array $r) => [
                'code' => $r['code'],
                'product' => $r['name'],
                'category' => $r['category'],
                'quantity' => Dec::qty($r['qty']),
                'unit' => $r['unit'],
                'returned' => Dec::qty($r['returned_qty']),
                'sales' => Dec::money($r['sales']),
                'refunds' => Dec::money($r['refunds']),
                'net_sales' => Dec::money($r['net']),
                'cogs' => Dec::money($r['cogs']),
                'gross_profit' => Dec::money($r['gross_profit']),
                'margin' => Dec::percent($r['gross_profit'], $r['revenue']),
            ], $rows),
            [
                'code' => 'Total', 'product' => count($rows).' products', 'category' => null, 'quantity' => null, 'unit' => null, 'returned' => null,
                'sales' => Dec::money($sum['sales']), 'refunds' => Dec::money($sum['refunds']), 'net_sales' => Dec::money($sum['net']),
                'cogs' => Dec::money($sum['cogs']), 'gross_profit' => Dec::money($sum['gross_profit']), 'margin' => Dec::percent($sum['gross_profit'], $sum['revenue']),
            ],
            ['Quantities are in each product\'s base unit. Sales include VAT; margin is on sales without VAT.'],
        );
    }
}
