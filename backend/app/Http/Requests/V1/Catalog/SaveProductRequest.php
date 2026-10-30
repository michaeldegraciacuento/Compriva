<?php

namespace App\Http\Requests\V1\Catalog;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /products (product + at least one SKU) or PATCH /products/{id}
 * (product fields only; SKUs have their own endpoints).
 */
class SaveProductRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $creating = $this->isMethod('post');
        $required = $creating ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],
            'category_id' => ['nullable', 'uuid', Rule::exists('categories', 'id')->whereNull('deleted_at')],
            'brand_id' => ['nullable', 'uuid', Rule::exists('brands', 'id')->whereNull('deleted_at')],
            'tax_rate_id' => [$required, 'uuid', Rule::exists('tax_rates', 'id')->where('is_active', true)],
            'track_inventory' => ['sometimes', 'boolean'],
            'track_batches' => ['sometimes', 'boolean'],
            'track_expiry' => ['sometimes', 'boolean'],
            ...($creating ? SaveSkuRequest::skuRules('skus.*.') + [
                'skus' => ['required', 'array', 'min:1', 'max:50'],
                'skus.*.code' => ['nullable', 'string', 'max:50', 'distinct:ignore_case', 'unique:product_skus,code'],
            ] : []),
        ];
    }
}
