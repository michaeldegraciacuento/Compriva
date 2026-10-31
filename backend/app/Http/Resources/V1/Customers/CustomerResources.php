<?php

namespace App\Http\Resources\V1\Customers;

use App\Models\Customer;
use App\Models\Sale;
use Illuminate\Support\Carbon;

/** Shapes for customers and their purchase history. */
final class CustomerResources
{
    /** @return array<string, mixed> */
    public static function customer(Customer $customer): array
    {
        return [
            'id' => $customer->id,
            'code' => $customer->code,
            'name' => $customer->name,
            'type' => $customer->type->value,
            'phone' => $customer->phone,
            'email' => $customer->email,
            'address' => $customer->address,
            'tin' => $customer->tin,
            'id_number' => $customer->id_number,
            'birth_date' => $customer->birth_date?->toDateString(),
            'notes' => $customer->notes,
            'is_active' => $customer->is_active,
            'purchases_count' => $customer->purchases_count ?? null,
            'purchases_total' => $customer->purchases_total !== null ? bcadd((string) $customer->purchases_total, '0', 2) : null,
            'last_purchase_at' => $customer->last_purchase_at !== null ? Carbon::parse($customer->last_purchase_at)->toIso8601ZuluString() : null,
            'created_at' => $customer->created_at?->toIso8601ZuluString(),
        ];
    }

    /** One line of the purchase history. @return array<string, mixed> */
    public static function purchase(Sale $sale): array
    {
        return [
            'id' => $sale->id,
            'receipt_number' => $sale->receipt_number,
            'status' => $sale->status,
            'occurred_at' => $sale->occurred_at->toIso8601ZuluString(),
            'terminal' => $sale->device?->code,
            'cashier' => $sale->cashier?->name,
            'items_count' => $sale->items_count ?? null,
            'customer_added_later' => $sale->relationLoaded('customerLink') && $sale->customerLink !== null,
            'grand_total' => $sale->grand_total,
        ];
    }
}
