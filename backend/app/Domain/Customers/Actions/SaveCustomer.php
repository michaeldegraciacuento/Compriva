<?php

namespace App\Domain\Customers\Actions;

use App\Domain\Customers\Enums\CustomerType;
use App\Models\Customer;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Creates and edits customers (docs/README.md).
 *
 * Senior citizens and PWDs must have their ID card number: it is printed on
 * every discounted receipt. Customers are never deleted (sales refer to them);
 * they are deactivated instead.
 */
class SaveCustomer
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** @param  array<string, mixed>  $data  validated */
    public function create(array $data): Customer
    {
        $this->assertIdNumber($data);

        return DB::transaction(function () use ($data) {
            $data['code'] ??= $this->nextCode();
            $data['type'] ??= CustomerType::Regular->value;
            $customer = Customer::create($data);
            $this->audit->record('customer.created', $customer, new: ['code' => $customer->code, 'name' => $customer->name, 'type' => $customer->type->value]);

            return $customer;
        });
    }

    /** @param  array<string, mixed>  $data  validated */
    public function update(Customer $customer, array $data): Customer
    {
        $this->assertIdNumber([
            'type' => $data['type'] ?? $customer->type->value,
            'id_number' => array_key_exists('id_number', $data) ? $data['id_number'] : $customer->id_number,
        ]);

        $before = collect($customer->only(array_keys($data)))
            ->map(fn ($value) => $value instanceof \BackedEnum ? $value->value : ($value instanceof \DateTimeInterface ? $value->format('Y-m-d') : $value))
            ->all();
        $customer->update($data);
        $this->audit->record('customer.updated', $customer, $before, $data);

        return $customer;
    }

    /** @param  array<string, mixed>  $data */
    private function assertIdNumber(array $data): void
    {
        $type = CustomerType::tryFrom((string) ($data['type'] ?? CustomerType::Regular->value));
        if (in_array($type, [CustomerType::SeniorCitizen, CustomerType::Pwd], true) && blank($data['id_number'] ?? null)) {
            $message = $type === CustomerType::SeniorCitizen ? 'Enter the senior citizen ID number.' : 'Enter the PWD ID number.';
            throw new BusinessException($message, ErrorCode::ValidationFailed, 422, ['fields' => ['id_number' => [$message]]]);
        }
    }

    /** C-0001, C-0002, … (the demo data uses the same format). */
    private function nextCode(): string
    {
        $max = Customer::withTrashed()->where('code', 'like', 'C-%')->lockForUpdate()->pluck('code')
            ->map(fn (string $code) => preg_match('/^C-(\d+)$/', $code, $m) ? (int) $m[1] : 0)->max() ?? 0;

        return sprintf('C-%04d', $max + 1);
    }
}
