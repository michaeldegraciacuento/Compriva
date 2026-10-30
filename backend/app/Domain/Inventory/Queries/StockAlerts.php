<?php

namespace App\Domain\Inventory\Queries;

use App\Models\InventoryLevel;
use App\Models\Setting;
use App\Models\StockBatch;
use Illuminate\Support\Carbon;

/**
 * Read-only stock alerts for the dashboard and notifications:
 *
 * - low stock: on hand at or below the SKU's reorder level (reorder level > 0)
 * - expiring: batches with stock left whose expiry date falls within the
 *   warning window (setting inventory.expiry_warning_days), including expired
 *
 * Dates are evaluated in the business timezone (config compriva.timezone).
 */
class StockAlerts
{
    public const LIMIT = 10;

    /** @return array<string, mixed> */
    public function get(int $limit = self::LIMIT): array
    {
        $today = Carbon::now(config('compriva.timezone'))->startOfDay();
        $windowDays = (int) (Setting::whereNull('store_id')->where('group', 'inventory')->where('key', 'expiry_warning_days')->value('value') ?? 30);

        $lowStock = InventoryLevel::query()
            ->join('product_skus', 'product_skus.id', '=', 'inventory_levels.product_sku_id')
            ->join('products', 'products.id', '=', 'product_skus.product_id')
            ->join('units', 'units.id', '=', 'product_skus.base_unit_id')
            ->whereNull('product_skus.deleted_at')
            ->where('product_skus.is_active', true)
            ->where('products.track_inventory', true)
            ->where('product_skus.reorder_level', '>', 0)
            ->whereColumn('inventory_levels.quantity_on_hand', '<=', 'product_skus.reorder_level');

        $expiring = StockBatch::query()
            ->join('product_skus', 'product_skus.id', '=', 'stock_batches.product_sku_id')
            ->join('units', 'units.id', '=', 'product_skus.base_unit_id')
            ->whereNull('product_skus.deleted_at')
            ->where('stock_batches.remaining_quantity', '>', 0)
            ->whereNotNull('stock_batches.expiry_date')
            ->whereDate('stock_batches.expiry_date', '<=', $today->copy()->addDays($windowDays)->toDateString());

        return [
            'low_stock' => [
                'total' => (clone $lowStock)->count(),
                'items' => $lowStock
                    // Most urgent first: smallest share of the reorder level left.
                    ->orderByRaw('inventory_levels.quantity_on_hand / product_skus.reorder_level')
                    ->limit($limit)
                    ->get([
                        'product_skus.id as sku_id', 'product_skus.code as sku_code', 'product_skus.name',
                        'inventory_levels.quantity_on_hand', 'product_skus.reorder_level', 'units.code as unit',
                    ])
                    ->map(fn ($row) => [
                        'sku_id' => $row->sku_id,
                        'sku_code' => $row->sku_code,
                        'name' => $row->name,
                        'quantity_on_hand' => $row->quantity_on_hand,
                        'reorder_level' => $row->reorder_level,
                        'unit' => $row->unit,
                    ])->values()->all(),
            ],
            'expiring' => [
                'total' => (clone $expiring)->count(),
                'window_days' => $windowDays,
                'items' => $expiring
                    ->orderBy('stock_batches.expiry_date')
                    ->limit($limit)
                    ->get([
                        'stock_batches.id as batch_id', 'stock_batches.batch_number', 'stock_batches.expiry_date',
                        'stock_batches.remaining_quantity', 'product_skus.id as sku_id', 'product_skus.name', 'units.code as unit',
                    ])
                    ->map(fn ($row) => [
                        'batch_id' => $row->batch_id,
                        'batch_number' => $row->batch_number,
                        'sku_id' => $row->sku_id,
                        'name' => $row->name,
                        'expiry_date' => $row->expiry_date->toDateString(),
                        // Whole business days between today and the expiry date (negative = expired).
                        'days_left' => (int) round($today->diffInDays(
                            Carbon::parse($row->expiry_date->toDateString(), config('compriva.timezone')),
                            false,
                        )),
                        'remaining_quantity' => $row->remaining_quantity,
                        'unit' => $row->unit,
                    ])->values()->all(),
            ],
            'generated_at' => now()->toIso8601ZuluString(),
        ];
    }
}
