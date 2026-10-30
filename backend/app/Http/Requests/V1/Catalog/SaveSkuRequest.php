<?php

namespace App\Http\Requests\V1\Catalog;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** POST /products/{id}/skus or PATCH /skus/{id}. */
class SaveSkuRequest extends FormRequest
{
    /** Shared with SaveProductRequest (prefix "skus.*."). @return array<string, mixed> */
    public static function skuRules(string $prefix = '', bool $creating = true): array
    {
        $required = $creating ? 'required' : 'sometimes';
        $money = ['numeric', 'min:0', 'max:99999999999', 'decimal:0,4'];

        return [
            "{$prefix}name" => ['nullable', 'string', 'max:255'],
            "{$prefix}variant" => ['nullable', 'string', 'max:100'],
            "{$prefix}base_unit_id" => [$required, 'uuid', Rule::exists('units', 'id')->where('is_active', true)],
            "{$prefix}cost_price" => ['sometimes', ...$money],
            "{$prefix}reorder_level" => ['sometimes', ...$money],
            "{$prefix}reorder_quantity" => ['sometimes', ...$money],
            "{$prefix}is_active" => ['sometimes', 'boolean'],
            ...($creating ? [
                "{$prefix}price" => ['required', ...$money],
                "{$prefix}barcode" => ['nullable', 'string', 'max:64'],
                "{$prefix}barcode_type" => ['nullable', Rule::in(['ean13', 'ean8', 'upca', 'code128', 'internal'])],
            ] : []),
        ];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $creating = $this->isMethod('post');
        $sku = $this->route('sku');

        return [
            ...self::skuRules('', $creating),
            'code' => ['nullable', 'string', 'max:50', Rule::unique('product_skus', 'code')->ignore($sku?->id)],
        ];
    }
}
