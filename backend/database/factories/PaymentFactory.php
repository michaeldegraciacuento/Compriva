<?php

namespace Database\Factories;

use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\Sale;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Payment> Cash payment of the full sale amount, exact tender. */
class PaymentFactory extends Factory
{
    public function definition(): array
    {
        return [
            'sale_id' => Sale::factory(),
            'payment_method_id' => PaymentMethod::factory(),
            'method_code' => fn (array $a) => PaymentMethod::find($a['payment_method_id'])->code,
            'amount' => fn (array $a) => Sale::find($a['sale_id'])->grand_total,
            'tendered_amount' => fn (array $a) => $a['amount'],
            'change_amount' => '0.0000',
            'paid_at' => now(),
        ];
    }
}
