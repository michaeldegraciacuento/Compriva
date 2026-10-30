<?php

namespace App\Http\Resources\V1\Inventory;

use App\Models\StockBatch;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/** A batch with its expiry status, in business days (Asia/Manila). @mixin StockBatch */
class StockBatchResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $daysLeft = $this->expiry_date === null ? null : (int) round(
            Carbon::now(config('compriva.timezone'))->startOfDay()
                ->diffInDays(Carbon::parse($this->expiry_date->toDateString(), config('compriva.timezone')), false),
        );

        return [
            'id' => $this->id,
            'batch_number' => $this->batch_number,
            'sku' => $this->whenLoaded('sku', fn () => [
                'id' => $this->sku->id, 'code' => $this->sku->code, 'name' => $this->sku->name,
                'unit' => $this->sku->relationLoaded('baseUnit') ? $this->sku->baseUnit->code : null,
            ]),
            'expiry_date' => $this->expiry_date?->toDateString(),
            'days_left' => $daysLeft,
            'unit_cost' => $this->unit_cost,
            'initial_quantity' => $this->initial_quantity,
            'remaining_quantity' => $this->remaining_quantity,
            'received_at' => $this->received_at?->toIso8601ZuluString(),
        ];
    }
}
