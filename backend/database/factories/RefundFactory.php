<?php

namespace Database\Factories;

use App\Models\PaymentMethod;
use App\Models\Refund;
use App\Models\SaleReturn;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Refund> */
class RefundFactory extends Factory
{
    public function definition(): array
    {
        return [
            'sale_return_id' => SaleReturn::factory(),
            'payment_method_id' => PaymentMethod::factory(),
            'method_code' => fn (array $a) => PaymentMethod::find($a['payment_method_id'])->code,
            'amount' => fn (array $a) => SaleReturn::find($a['sale_return_id'])->total_refund,
            'refunded_at' => now(),
        ];
    }
}
