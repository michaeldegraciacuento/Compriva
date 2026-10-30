<?php

namespace App\Http\Resources\V1\Inventory;

use App\Models\StockMovement;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** A stock ledger entry (stock history). @mixin StockMovement */
class StockMovementResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $reference = $this->relationLoaded('reference') ? $this->reference : null;

        return [
            'id' => $this->id,
            'type' => $this->type,
            'quantity' => $this->quantity,
            'unit_cost' => $this->unit_cost,
            'sku' => $this->whenLoaded('sku', fn () => ['id' => $this->sku->id, 'code' => $this->sku->code, 'name' => $this->sku->name]),
            'batch' => $this->whenLoaded('batch', fn () => $this->batch ? ['id' => $this->batch->id, 'batch_number' => $this->batch->batch_number] : null),
            'reference' => $this->reference_type ? [
                'type' => $this->reference_type,
                'id' => $this->reference_id,
                'number' => $reference?->adjustment_number ?? $reference?->receipt_number ?? $reference?->return_number ?? null,
            ] : null,
            'created_by' => $this->whenLoaded('creator', fn () => $this->creator ? ['id' => $this->creator->id, 'name' => $this->creator->name] : null),
            'occurred_at' => $this->occurred_at?->toIso8601ZuluString(),
        ];
    }
}
