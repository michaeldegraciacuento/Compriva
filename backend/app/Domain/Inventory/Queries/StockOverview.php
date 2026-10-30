<?php

namespace App\Domain\Inventory\Queries;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Stock per SKU: on hand, allocated to terminals, available, reorder level,
 * average cost, stock value, status (out / low / ok) and nearest expiry.
 * SKUs that never had stock appear with zero quantities.
 */
class StockOverview
{
    /** @param  array{q?: ?string, category_id?: ?string, status?: ?string, include_inactive?: bool}  $filters */
    public function paginate(array $filters, int $perPage = 25): LengthAwarePaginator
    {
        return $this->base($filters)
            ->select([
                'product_skus.id as sku_id', 'product_skus.code as sku_code', 'product_skus.name', 'product_skus.is_active',
                'products.id as product_id', 'categories.name as category', 'units.code as unit',
                DB::raw('COALESCE(inventory_levels.quantity_on_hand, 0) as quantity_on_hand'),
                DB::raw('COALESCE(inventory_levels.quantity_allocated, 0) as quantity_allocated'),
                'product_skus.reorder_level',
                DB::raw('COALESCE(inventory_levels.average_cost, product_skus.cost_price) as average_cost'),
                'inventory_levels.last_movement_at',
                DB::raw('(SELECT MIN(b.expiry_date) FROM stock_batches b WHERE b.product_sku_id = product_skus.id AND b.remaining_quantity > 0) as nearest_expiry'),
            ])
            ->orderBy('product_skus.name')
            ->paginate($perPage);
    }

    /** Totals for the summary tiles (same filters except status). @return array<string, mixed> */
    public function summary(array $filters): array
    {
        $row = $this->base([...$filters, 'status' => null])
            ->selectRaw('COUNT(*) as skus')
            ->selectRaw('SUM(CASE WHEN COALESCE(inventory_levels.quantity_on_hand, 0) <= 0 THEN 1 ELSE 0 END) as out_of_stock')
            ->selectRaw('SUM(CASE WHEN COALESCE(inventory_levels.quantity_on_hand, 0) > 0 AND product_skus.reorder_level > 0 AND inventory_levels.quantity_on_hand <= product_skus.reorder_level THEN 1 ELSE 0 END) as low_stock')
            ->selectRaw('COALESCE(SUM(GREATEST(COALESCE(inventory_levels.quantity_on_hand, 0), 0) * COALESCE(inventory_levels.average_cost, 0)), 0) as stock_value')
            ->first();

        return [
            'skus' => (int) $row->skus,
            'out_of_stock' => (int) $row->out_of_stock,
            'low_stock' => (int) $row->low_stock,
            'stock_value' => bcadd((string) $row->stock_value, '0', 4),
        ];
    }

    private function base(array $filters): Builder
    {
        $onHand = 'COALESCE(inventory_levels.quantity_on_hand, 0)';

        return DB::table('product_skus')
            ->join('products', 'products.id', '=', 'product_skus.product_id')
            ->join('units', 'units.id', '=', 'product_skus.base_unit_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->leftJoin('inventory_levels', 'inventory_levels.product_sku_id', '=', 'product_skus.id')
            ->whereNull('product_skus.deleted_at')
            ->whereNull('products.deleted_at')
            ->where('products.track_inventory', true)
            ->when(! ($filters['include_inactive'] ?? false), fn (Builder $q) => $q->where('product_skus.is_active', true)->where('products.is_active', true))
            ->when($filters['q'] ?? null, fn (Builder $q, string $term) => $q->where(fn (Builder $q) => $q
                ->where('product_skus.name', 'like', "%{$term}%")
                ->orWhere('product_skus.code', 'like', "%{$term}%")
                ->orWhereExists(fn (Builder $q) => $q->from('product_barcodes')
                    ->whereColumn('product_barcodes.product_sku_id', 'product_skus.id')
                    ->where('product_barcodes.barcode', $term))))
            ->when($filters['category_id'] ?? null, fn (Builder $q, string $id) => $q->where('products.category_id', $id))
            ->when(($filters['status'] ?? null) === 'out', fn (Builder $q) => $q->whereRaw("{$onHand} <= 0"))
            ->when(($filters['status'] ?? null) === 'low', fn (Builder $q) => $q->whereRaw("{$onHand} > 0")
                ->where('product_skus.reorder_level', '>', 0)
                ->whereColumn('inventory_levels.quantity_on_hand', '<=', 'product_skus.reorder_level'))
            ->when(($filters['status'] ?? null) === 'ok', fn (Builder $q) => $q->whereRaw("{$onHand} > 0")
                ->where(fn (Builder $q) => $q->where('product_skus.reorder_level', '<=', 0)
                    ->orWhereColumn('inventory_levels.quantity_on_hand', '>', 'product_skus.reorder_level')));
    }
}
