<?php

namespace Database\Factories;

use App\Models\Sale;
use App\Models\SaleDiscount;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<SaleDiscount> */
class SaleDiscountFactory extends Factory
{
    public function definition(): array
    {
        return [
            'sale_id' => Sale::factory(),
            'name' => 'Promo 10%',
            'kind' => 'promotional',
            'type' => 'percentage',
            'value' => '10.0000',
            'amount' => '10.0000',
        ];
    }
}
