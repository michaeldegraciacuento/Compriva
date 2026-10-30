<?php

namespace Database\Factories;

use App\Models\Product;
use App\Models\ProductSku;
use App\Models\Unit;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ProductSku> */
class ProductSkuFactory extends Factory
{
    public function definition(): array
    {
        return [
            'product_id' => Product::factory(),
            'base_unit_id' => Unit::factory(),
            'code' => fake()->unique()->bothify('SKU-#####'),
            'name' => fn (array $attributes) => Product::find($attributes['product_id'])->name,
            'cost_price' => fake()->randomFloat(4, 5, 500),
        ];
    }
}
