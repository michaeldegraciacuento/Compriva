<?php

namespace App\Http\Requests\V1\Sales;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Shape of a POS cart, for quotes (POST /pos/quote) and checkout
 * (POST /pos/checkout). Prices, units, taxes and payment rules are checked by
 * CartPricer, TenderCalculator and CompleteSale.
 */
class CheckoutRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $checkout = $this->routeIs('api.v1.pos.checkout');
        $manualDiscount = Rule::requiredIf(fn () => $this->filled('discount') && ! $this->filled('discount.discount_id'));

        return [
            'id' => [$checkout ? 'required' : 'nullable', 'uuid'],
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.sku_id' => ['required', 'uuid'],
            'lines.*.unit_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'decimal:0,4', 'gt:0', 'max:99999'],
            'lines.*.barcode' => ['nullable', 'string', 'max:64'],
            'lines.*.unit_price' => ['nullable', 'decimal:0,4', 'min:0', 'max:9999999'],
            'lines.*.discount' => ['nullable', 'array'],
            'lines.*.discount.type' => ['required_with:lines.*.discount', 'in:percentage,fixed_amount'],
            'lines.*.discount.value' => ['required_with:lines.*.discount', 'decimal:0,2', 'gt:0'],
            'discount' => ['nullable', 'array'],
            'discount.discount_id' => ['nullable', 'uuid'],
            'discount.type' => [$manualDiscount, 'nullable', 'in:percentage,fixed_amount'],
            'discount.value' => [$manualDiscount, 'nullable', 'decimal:0,2', 'gt:0'],
            'discount.name' => ['nullable', 'string', 'max:100'],
            'discount.customer_id_number' => ['nullable', 'string', 'max:50'],
            'payments' => [$checkout ? 'present' : 'nullable', 'array', 'max:10'],
            'payments.*.method' => ['required', 'string', 'max:30'],
            'payments.*.amount' => ['required', 'decimal:0,2', 'gt:0', 'max:9999999'],
            'payments.*.reference' => ['nullable', 'string', 'max:100'],
            'expected_total' => ['nullable', 'decimal:0,2', 'min:0'],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string', 'max:500'],
            'approval' => ['nullable', 'array'],
            'approval.login' => ['nullable', 'string', 'max:100'],
            'approval.secret' => ['nullable', 'string', 'max:100'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            foreach ($this->input('lines', []) as $i => $line) {
                if (($line['discount']['type'] ?? null) === 'percentage' && self::over100($line['discount']['value'] ?? null)) {
                    $validator->errors()->add("lines.{$i}.discount.value", 'A percentage discount cannot exceed 100%.');
                }
            }
            if ($this->input('discount.type') === 'percentage' && self::over100($this->input('discount.value'))) {
                $validator->errors()->add('discount.value', 'A percentage discount cannot exceed 100%.');
            }
        }];
    }

    private static function over100(mixed $value): bool
    {
        return is_numeric($value) && bccomp((string) $value, '100', 4) > 0;
    }
}
