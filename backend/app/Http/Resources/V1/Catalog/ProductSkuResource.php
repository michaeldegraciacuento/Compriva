<?php

namespace App\Http\Resources\V1\Catalog;

use App\Models\ProductSku;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A SKU with its barcodes, units and current prices (when loaded).
 * `prices` contains only the prices in effect now; history is GET /skus/{id}/prices.
 *
 * @mixin ProductSku
 */
class ProductSkuResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $level = $this->relationLoaded('inventoryLevels') ? $this->inventoryLevels->first() : null;

        return [
            'id' => $this->id,
            'product_id' => $this->product_id,
            'product_name' => $this->whenLoaded('product', fn () => $this->product->name),
            'tracks' => $this->whenLoaded('product', fn () => [
                'batches' => $this->product->track_batches,
                'expiry' => $this->product->track_expiry,
            ]),
            'code' => $this->code,
            'name' => $this->name,
            'variant' => $this->variant,
            'base_unit' => $this->whenLoaded('baseUnit', fn () => CatalogResources::unit($this->baseUnit)),
            'cost_price' => $this->cost_price,
            'reorder_level' => $this->reorder_level,
            'reorder_quantity' => $this->reorder_quantity,
            'is_active' => $this->is_active,
            'barcodes' => $this->whenLoaded('barcodes', fn () => $this->barcodes->map(fn ($b) => [
                'id' => $b->id,
                'barcode' => $b->barcode,
                'type' => $b->type,
                'unit' => $b->relationLoaded('unit') ? CatalogResources::unit($b->unit) : null,
                'is_primary' => $b->is_primary,
            ])->values()),
            'conversions' => $this->whenLoaded('unitConversions', fn () => $this->unitConversions->sortBy('factor')->map(fn ($c) => [
                'id' => $c->id,
                'unit' => CatalogResources::unit($c->unit),
                'factor' => $c->factor,
                'is_base' => $c->unit_id === $this->base_unit_id,
                'is_purchase_unit' => $c->is_purchase_unit,
                'is_sales_unit' => $c->is_sales_unit,
            ])->values()),
            'prices' => $this->whenLoaded('prices', fn () => $this->prices->map(fn ($p) => CatalogResources::price($p))->values()),
            'stock' => $this->whenLoaded('inventoryLevels', fn () => [
                'quantity_on_hand' => $level?->quantity_on_hand ?? '0.0000',
                'quantity_allocated' => $level?->quantity_allocated ?? '0.0000',
                'average_cost' => $level?->average_cost ?? $this->cost_price,
            ]),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
