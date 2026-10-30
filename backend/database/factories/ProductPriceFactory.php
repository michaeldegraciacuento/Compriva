<?php

namespace Database\Factories;

use App\Models\ProductPrice;
use App\Models\ProductSku;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ProductPrice> */
class ProductPriceFactory extends Factory
{
    public function definition(): array
    {
        return [
            'product_sku_id' => ProductSku::factory(),
            'unit_id' => fn (array $attributes) => ProductSku::find($attributes['product_sku_id'])->base_unit_id,
            'tier' => 'retail',
            'price' => fake()->randomFloat(2, 10, 600),
            'effective_from' => now()->subDay(),
        ];
    }
}
