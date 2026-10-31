<?php

namespace App\Domain\Customers;

use App\Domain\Customers\Enums\CustomerType;
use App\Models\Customer;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;

/**
 * The customer columns stored on a sale. The sale keeps a snapshot (name, TIN,
 * address, ID number), so later edits to the customer never change a receipt.
 *
 * Online checkout refuses an unknown or inactive customer. An offline sale is
 * never rejected for its customer: if the customer was deactivated or removed
 * meanwhile, the link is kept when possible and the typed name otherwise.
 */
final class SaleCustomer
{
    /**
     * @return array{customer: ?Customer, columns: array{customer_id: ?string, customer_name: ?string, customer_tin: ?string, customer_address: ?string}}
     */
    public static function resolve(?string $customerId, ?string $typedName, bool $offline = false): array
    {
        $typedName = filled($typedName) ? trim($typedName) : null;
        $customer = $customerId ? Customer::withTrashed()->find($customerId) : null;

        if ($customerId && ! $offline && ($customer === null || $customer->trashed() || ! $customer->is_active)) {
            $message = 'This customer is not active. Choose another customer or remove them from the sale.';
            throw new BusinessException($message, ErrorCode::ValidationFailed, 422, ['fields' => ['customer_id' => [$message]]]);
        }

        if ($customer === null) {
            return ['customer' => null, 'columns' => ['customer_id' => null, 'customer_name' => $typedName, 'customer_tin' => null, 'customer_address' => null]];
        }

        $business = $customer->type === CustomerType::Business;

        return ['customer' => $customer, 'columns' => [
            'customer_id' => $customer->id,
            'customer_name' => $typedName ?? $customer->name,
            'customer_tin' => $customer->tin,
            'customer_address' => $business ? $customer->address : null,
        ]];
    }

    /**
     * A preset discount that needs an ID number takes the customer's when the
     * cashier left it empty (a senior citizen chosen from the customer list).
     *
     * @param  array<string, mixed>|null  $discount
     * @return array<string, mixed>|null
     */
    public static function fillIdNumber(?array $discount, ?Customer $customer): ?array
    {
        if ($discount === null || $customer === null || blank($customer->id_number) || ! empty($discount['customer_id_number'])) {
            return $discount;
        }
        if (! in_array($customer->type, [CustomerType::SeniorCitizen, CustomerType::Pwd], true) || empty($discount['discount_id'])) {
            return $discount;
        }

        return [...$discount, 'customer_id_number' => $customer->id_number];
    }
}
