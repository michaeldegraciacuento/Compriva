<?php

namespace Database\Factories;

use App\Models\Discount;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Discount> */
class DiscountFactory extends Factory
{
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->bothify('PROMO##??'),
            'name' => fake()->words(2, true).' promo',
            'kind' => 'promotional',
            'type' => 'percentage',
            'value' => '10.0000',
            'scope' => 'sale',
        ];
    }

    public function seniorCitizen(): static
    {
        return $this->state(fn () => [
            'name' => 'Senior Citizen 20%',
            'kind' => 'senior_citizen',
            'value' => '20.0000',
            'is_vat_exempt' => true,
            'requires_customer_id' => true,
        ]);
    }
}
