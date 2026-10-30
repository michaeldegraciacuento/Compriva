<?php

namespace Database\Factories;

use App\Models\PaymentMethod;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<PaymentMethod> */
class PaymentMethodFactory extends Factory
{
    /** Cash by default. */
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->bothify('cash-##??'),
            'name' => 'Cash',
            'type' => 'cash',
            'opens_cash_drawer' => true,
            'allows_change' => true,
        ];
    }

    public function eWallet(): static
    {
        return $this->state(fn () => [
            'name' => 'GCash', 'type' => 'e_wallet', 'requires_reference' => true,
            'opens_cash_drawer' => false, 'allows_change' => false,
        ]);
    }
}
