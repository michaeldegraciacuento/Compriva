<?php

namespace App\Domain\Customers\Actions;

use App\Domain\Sales\Enums\SaleStatus;
use App\Models\Customer;
use App\Models\Sale;
use App\Models\SaleCustomerLink;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * "I forgot to choose the customer": adds a customer to a completed sale that
 * had none (docs/README.md). The sale and its printed
 * receipt do not change, so this never touches money, stock or the receipt;
 * it only puts the sale in the customer's purchase history. A discount or a
 * TIN on the receipt still needs a void and a new sale.
 */
class AddCustomerToSale
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function execute(User $actor, Sale $sale, string $customerId, ?string $reason = null): SaleCustomerLink
    {
        if ($sale->status !== SaleStatus::Completed) {
            throw new BusinessException('A voided sale cannot get a customer.', ErrorCode::Conflict, 409, ['reason' => 'voided']);
        }
        if ($sale->customer_id !== null || $sale->customerLink()->exists()) {
            throw new BusinessException('This sale already has a customer.', ErrorCode::Conflict, 409, ['reason' => 'has_customer']);
        }
        $customer = Customer::whereKey($customerId)->where('is_active', true)->first();
        if ($customer === null) {
            $message = 'Choose an active customer.';
            throw new BusinessException($message, ErrorCode::ValidationFailed, 422, ['fields' => ['customer_id' => [$message]]]);
        }

        try {
            return DB::transaction(function () use ($actor, $sale, $customer, $reason) {
                $link = SaleCustomerLink::create(['sale_id' => $sale->id, 'customer_id' => $customer->id, 'linked_by' => $actor->id, 'reason' => $reason]);
                $this->audit->record('sale.customer_added', $sale, new: [
                    'receipt_number' => $sale->receipt_number, 'customer_id' => $customer->id, 'customer' => $customer->name, 'reason' => $reason,
                ]);

                return $link;
            });
        } catch (UniqueConstraintViolationException) {
            throw new BusinessException('This sale already has a customer.', ErrorCode::Conflict, 409, ['reason' => 'has_customer']);
        }
    }
}
