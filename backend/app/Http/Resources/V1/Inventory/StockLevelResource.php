<?php

namespace App\Http\Resources\V1\Inventory;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/** A row of the stock overview (StockOverview query). */
class StockLevelResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $onHand = bcadd((string) $this->quantity_on_hand, '0', 4);
        $allocated = bcadd((string) $this->quantity_allocated, '0', 4);
        $reorder = bcadd((string) $this->reorder_level, '0', 4);
        $cost = bcadd((string) $this->average_cost, '0', 4);

        $status = match (true) {
            bccomp($onHand, '0', 4) <= 0 => 'out',
            bccomp($reorder, '0', 4) > 0 && bccomp($onHand, $reorder, 4) <= 0 => 'low',
            default => 'ok',
        };

        return [
            'sku_id' => $this->sku_id,
            'sku_code' => $this->sku_code,
            'name' => $this->name,
            'product_id' => $this->product_id,
            'category' => $this->category,
            'unit' => $this->unit,
            'is_active' => (bool) $this->is_active,
            'quantity_on_hand' => $onHand,
            'quantity_allocated' => $allocated,
            'quantity_available' => bcsub($onHand, $allocated, 4),
            'reorder_level' => $reorder,
            'average_cost' => $cost,
            'stock_value' => bccomp($onHand, '0', 4) > 0 ? bcmul($onHand, $cost, 4) : '0.0000',
            'status' => $status,
            'nearest_expiry' => $this->nearest_expiry,
            'last_movement_at' => $this->last_movement_at ? Carbon::parse($this->last_movement_at)->toIso8601ZuluString() : null,
        ];
    }
}
