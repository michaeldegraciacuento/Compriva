<?php

namespace App\Domain\Reporting\Queries;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\ReportFilters;
use Illuminate\Support\Facades\DB;

/**
 * Sales per SKU in a date range: quantities in base units, sales, VAT and
 * cost from the sale line snapshots; returns processed in the range are
 * subtracted. Category is the product's current category.
 */
class ProductSales
{
    /** @return list<array<string, mixed>> */
    public function between(ReportFilters $filters): array
    {
        $range = [$filters->fromDate(), $filters->toDate()];

        $sold = DB::table('sale_items')->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.status', 'completed')->whereBetween('sales.business_date', $range)
            ->groupBy('sale_items.product_sku_id')
            ->selectRaw('sale_items.product_sku_id AS sku_id, SUM(sale_items.base_quantity) AS qty, SUM(sale_items.line_total) AS sales,
                SUM(sale_items.tax_amount) AS tax, SUM(sale_items.unit_cost * sale_items.quantity) AS cost')
            ->get()->keyBy('sku_id');

        $returned = DB::table('sale_return_items')
            ->join('sale_returns', 'sale_returns.id', '=', 'sale_return_items.sale_return_id')
            ->join('sale_items', 'sale_items.id', '=', 'sale_return_items.sale_item_id')
            ->whereBetween('sale_returns.business_date', $range)
            ->groupBy('sale_return_items.product_sku_id')
            ->selectRaw('sale_return_items.product_sku_id AS sku_id, SUM(sale_return_items.base_quantity) AS qty, SUM(sale_return_items.refund_amount) AS refunds,
                SUM(sale_return_items.tax_amount) AS tax,
                SUM(CASE WHEN sale_return_items.restock = 1 THEN sale_return_items.quantity * sale_items.unit_cost ELSE 0 END) AS cost')
            ->get()->keyBy('sku_id');

        $ids = $sold->keys()->merge($returned->keys())->unique()->values();
        $skus = DB::table('product_skus')
            ->join('products', 'products.id', '=', 'product_skus.product_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->join('units', 'units.id', '=', 'product_skus.base_unit_id')
            ->whereIn('product_skus.id', $ids)
            ->select('product_skus.id', 'product_skus.code', 'product_skus.name', 'categories.name AS category', 'units.code AS unit')
            ->get()->keyBy('id');

        return $ids->map(function (string $id) use ($sold, $returned, $skus) {
            $s = $sold->get($id);
            $r = $returned->get($id);
            $sku = $skus->get($id);
            $net = Dec::sub($s->sales ?? 0, $r->refunds ?? 0);
            $revenue = Dec::sub($net, Dec::sub($s->tax ?? 0, $r->tax ?? 0));
            $cogs = Dec::sub($s->cost ?? 0, $r->cost ?? 0);

            return [
                'sku_id' => $id,
                'code' => $sku->code,
                'name' => $sku->name,
                'category' => $sku->category ?? 'Uncategorized',
                'unit' => $sku->unit,
                'qty' => Dec::of($s->qty ?? 0),
                'returned_qty' => Dec::of($r->qty ?? 0),
                'sales' => Dec::of($s->sales ?? 0),
                'refunds' => Dec::of($r->refunds ?? 0),
                'net' => $net,
                'revenue' => $revenue,
                'cogs' => $cogs,
                'gross_profit' => Dec::sub($revenue, $cogs),
            ];
        })->sort(fn (array $a, array $b) => bccomp($b['net'], $a['net'], 8) ?: strcmp($a['name'], $b['name']))->values()->all();
    }
}
