<?php

namespace Database\Factories;

use App\Models\ProductSku;
use App\Models\Unit;
use App\Models\UnitConversion;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<UnitConversion> */
class UnitConversionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'product_sku_id' => ProductSku::factory(),
            'unit_id' => Unit::factory(),
            'factor' => (string) fake()->randomElement([6, 12, 24, 48]),
            'is_purchase_unit' => true,
        ];
    }
}
