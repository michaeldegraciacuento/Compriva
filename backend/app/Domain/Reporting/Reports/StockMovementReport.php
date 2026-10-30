<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;
use Illuminate\Support\Facades\DB;

/**
 * Stock in and out per product over a period, from the stock ledger:
 * opening + received + sold + returned + adjusted = closing (base units).
 */
class StockMovementReport extends Report
{
    /** Movement types per column. Sold includes voids, which put stock back. */
    private const GROUPS = [
        'received' => ['purchase_receipt', 'stock_in', 'opening_balance'],
        'sold' => ['sale', 'sale_void'],
        'returned' => ['sale_return'],
        'adjusted' => ['adjustment', 'stock_out'],
    ];

    public function key(): string
    {
        return 'stock-movement';
    }

    public function title(): string
    {
        return 'Stock movement';
    }

    public function description(): string
    {
        return 'Opening stock, received, sold, returned, adjusted and closing stock per product.';
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $from = $filters->fromUtc();
        $to = $filters->toUtc();

        $opening = DB::table('stock_movements')->where('occurred_at', '<', $from)
            ->groupBy('product_sku_id')->selectRaw('product_sku_id, SUM(quantity) AS qty')->pluck('qty', 'product_sku_id');

        $cases = collect(self::GROUPS)->map(fn (array $types, string $name) => sprintf(
            "SUM(CASE WHEN type IN ('%s') THEN quantity ELSE 0 END) AS %s", implode("','", $types), $name,
        ))->implode(', ');
        $period = DB::table('stock_movements')->where('occurred_at', '>=', $from)->where('occurred_at', '<', $to)
            ->groupBy('product_sku_id')->selectRaw("product_sku_id, {$cases}")->get()->keyBy('product_sku_id');

        $ids = $period->keys()->merge($opening->filter(fn ($q) => bccomp((string) $q, '0', 4) !== 0)->keys())->unique();
        $skus = DB::table('product_skus')
            ->join('products', 'products.id', '=', 'product_skus.product_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->join('units', 'units.id', '=', 'product_skus.base_unit_id')
            ->whereIn('product_skus.id', $ids)
            ->orderBy('product_skus.name')
            ->get(['product_skus.id', 'product_skus.code', 'product_skus.name', 'categories.name AS category', 'units.code AS unit']);

        $rows = $skus->map(function ($sku) use ($opening, $period) {
            $p = $period->get($sku->id);
            $open = Dec::of($opening[$sku->id] ?? 0);
            $moves = array_map(fn (string $name) => Dec::of($p->{$name} ?? 0), array_combine(array_keys(self::GROUPS), array_keys(self::GROUPS)));

            return [
                'code' => $sku->code,
                'product' => $sku->name,
                'category' => $sku->category ?? 'Uncategorized',
                'unit' => $sku->unit,
                'opening' => Dec::qty($open),
                'received' => Dec::qty($moves['received']),
                'sold' => Dec::qty(bcmul($moves['sold'], '-1', 8)),
                'returned' => Dec::qty($moves['returned']),
                'adjusted' => Dec::qty($moves['adjusted']),
                'closing' => Dec::qty(Dec::add($open, ...array_values($moves))),
            ];
        })->values()->all();

        return new ReportResult(
            $this->key(), $this->title(), $filters->rangeLabel(),
            [
                self::col('code', 'SKU'),
                self::col('product', 'Product'),
                self::col('category', 'Category'),
                self::col('unit', 'Unit'),
                self::col('opening', 'Opening', 'qty'),
                self::col('received', 'Received', 'qty'),
                self::col('sold', 'Sold', 'qty'),
                self::col('returned', 'Returned', 'qty'),
                self::col('adjusted', 'Adjusted', 'qty'),
                self::col('closing', 'Closing', 'qty'),
            ],
            $rows,
            null,
            ['From the stock ledger, in each product\'s base unit. Received = deliveries, stock-ins and opening balances; adjusted = counts and stock-outs (negative = removed). Sold is net of voids.'],
        );
    }
}
