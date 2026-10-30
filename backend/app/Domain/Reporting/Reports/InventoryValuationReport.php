<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;
use Illuminate\Support\Facades\DB;

/** Stock on hand now, valued at average cost and at the current retail price. */
class InventoryValuationReport extends Report
{
    public function key(): string
    {
        return 'inventory-valuation';
    }

    public function title(): string
    {
        return 'Inventory valuation';
    }

    public function description(): string
    {
        return 'Stock on hand right now, at average cost and at retail price, per product and in total.';
    }

    public function filters(): array
    {
        return [];
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $levels = DB::table('inventory_levels')
            ->join('product_skus', 'product_skus.id', '=', 'inventory_levels.product_sku_id')
            ->join('products', 'products.id', '=', 'product_skus.product_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->join('units', 'units.id', '=', 'product_skus.base_unit_id')
            ->whereNull('product_skus.deleted_at')
            ->where('inventory_levels.quantity_on_hand', '<>', 0)
            ->orderBy('categories.name')->orderBy('product_skus.name')
            ->select('product_skus.id', 'product_skus.code', 'product_skus.name', 'product_skus.base_unit_id', 'categories.name AS category', 'units.code AS unit',
                'inventory_levels.quantity_on_hand', 'inventory_levels.average_cost')
            ->get();

        $now = now();
        $prices = DB::table('product_prices')->whereIn('product_sku_id', $levels->pluck('id'))->where('tier', 'retail')
            ->where('effective_from', '<=', $now)->where(fn ($q) => $q->whereNull('effective_to')->orWhere('effective_to', '>', $now))
            ->orderBy('effective_from')
            ->get(['product_sku_id', 'unit_id', 'price'])
            ->mapWithKeys(fn ($p) => ["{$p->product_sku_id}|{$p->unit_id}" => $p->price]);

        $cost = $retail = '0';
        $rows = $levels->map(function ($l) use ($prices, &$cost, &$retail) {
            $price = $prices["{$l->id}|{$l->base_unit_id}"] ?? null;
            $costValue = bcmul($l->quantity_on_hand, $l->average_cost, 8);
            $retailValue = $price === null ? null : bcmul($l->quantity_on_hand, $price, 8);
            $cost = Dec::add($cost, $costValue);
            $retail = Dec::add($retail, $retailValue ?? 0);

            return [
                'code' => $l->code,
                'product' => $l->name,
                'category' => $l->category ?? 'Uncategorized',
                'on_hand' => Dec::qty($l->quantity_on_hand),
                'unit' => $l->unit,
                'average_cost' => Dec::round($l->average_cost, 4),
                'cost_value' => Dec::money($costValue),
                'retail_price' => $price === null ? null : Dec::money($price),
                'retail_value' => $retailValue === null ? null : Dec::money($retailValue),
                'potential_profit' => $retailValue === null ? null : Dec::money(Dec::sub($retailValue, $costValue)),
            ];
        })->all();

        return new ReportResult(
            $this->key(), $this->title(), 'As of '.$filters->today()->format('j M Y'),
            [
                self::col('code', 'SKU'),
                self::col('product', 'Product'),
                self::col('category', 'Category'),
                self::col('on_hand', 'On hand', 'qty'),
                self::col('unit', 'Unit'),
                self::col('average_cost', 'Average cost', 'money', true),
                self::col('cost_value', 'Value at cost', 'money', true),
                self::col('retail_price', 'Retail price', 'money'),
                self::col('retail_value', 'Value at retail', 'money'),
                self::col('potential_profit', 'Potential profit', 'money', true),
            ],
            $rows,
            [
                'code' => 'Total', 'product' => count($rows).' products', 'category' => null, 'on_hand' => null, 'unit' => null, 'average_cost' => null,
                'cost_value' => Dec::money($cost), 'retail_price' => null, 'retail_value' => Dec::money($retail), 'potential_profit' => Dec::money(Dec::sub($retail, $cost)),
            ],
            ['Value at cost uses the weighted average cost. Negative stock (sold beyond the records) lowers the value; count it to correct it.'],
        );
    }
}
