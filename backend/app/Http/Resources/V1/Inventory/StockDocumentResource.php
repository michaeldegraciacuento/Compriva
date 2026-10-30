<?php

namespace App\Http\Resources\V1\Inventory;

use App\Models\StockAdjustment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** A stock-in, stock-out or count document. @mixin StockAdjustment */
class StockDocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'number' => $this->adjustment_number,
            'type' => $this->type,
            'reason' => $this->reason,
            'reason_label' => $this->reason->label(),
            'status' => $this->status,
            'reference' => $this->reference,
            'notes' => $this->notes,
            'created_by' => $this->whenLoaded('creator', fn () => ['id' => $this->creator->id, 'name' => $this->creator->name]),
            'approved_by' => $this->whenLoaded('approver', fn () => $this->approver ? ['id' => $this->approver->id, 'name' => $this->approver->name] : null),
            'lines_count' => $this->whenCounted('items'),
            'lines' => $this->whenLoaded('items', fn () => $this->items->map(fn ($item) => [
                'id' => $item->id,
                'sku' => ['id' => $item->sku->id, 'code' => $item->sku->code, 'name' => $item->sku->name],
                'unit' => $item->unit ? ['id' => $item->unit->id, 'code' => $item->unit->code] : null,
                'quantity' => $item->quantity,
                'conversion_factor' => $item->conversion_factor,
                'system_quantity' => $item->system_quantity,
                'counted_quantity' => $item->counted_quantity,
                'quantity_change' => $item->quantity_change,
                'unit_cost' => $item->unit_cost,
                'batch' => $item->batch ? ['id' => $item->batch->id, 'batch_number' => $item->batch->batch_number, 'expiry_date' => $item->batch->expiry_date?->toDateString()] : null,
                'batch_number' => $item->batch_number,
                'expiry_date' => $item->expiry_date?->toDateString(),
                'notes' => $item->notes,
            ])->values()),
            'posted_at' => $this->posted_at?->toIso8601ZuluString(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
