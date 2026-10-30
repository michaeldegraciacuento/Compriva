<?php

namespace Database\Factories;

use App\Models\TaxRate;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<TaxRate> */
class TaxRateFactory extends Factory
{
    /** VAT 12%, inclusive (the Philippine default). */
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->bothify('VAT-###'),
            'name' => 'VAT 12%',
            'type' => 'vat',
            'rate' => '12.0000',
            'is_inclusive' => true,
        ];
    }

    public function vatExempt(): static
    {
        return $this->state(fn () => ['name' => 'VAT-exempt', 'type' => 'vat_exempt', 'rate' => '0.0000']);
    }
}
