<?php

namespace App\Http\Requests\V1\Inventory;

use App\Domain\Inventory\Enums\AdjustmentReason;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Shape of a stock-in / stock-out / count document. Catalog-dependent rules
 * (units, decimals, batches, expiry, availability) are checked by
 * CreateStockDocument and, for quantities, again by the StockLedger.
 */
class StoreStockDocumentRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['required', Rule::enum(AdjustmentReason::class)],
            'reference' => ['nullable', 'string', 'max:50'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.product_sku_id' => ['required', 'uuid', 'distinct:strict'],
            'lines.*.unit_id' => ['nullable', 'uuid'],
            'lines.*.quantity' => ['nullable', 'numeric'],
            'lines.*.counted_quantity' => ['nullable', 'numeric', 'min:0'],
            'lines.*.unit_cost' => ['nullable', 'numeric', 'min:0'],
            'lines.*.batch_number' => ['nullable', 'string', 'max:50'],
            'lines.*.expiry_date' => ['nullable', 'date_format:Y-m-d'],
            'lines.*.stock_batch_id' => ['nullable', 'uuid'],
            'lines.*.notes' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function messages(): array
    {
        return ['lines.*.product_sku_id.distinct' => 'Each product may appear only once per document.'];
    }
}
