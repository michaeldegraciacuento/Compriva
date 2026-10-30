<?php

namespace Database\Factories;

use App\Models\Category;
use App\Models\Product;
use App\Models\TaxRate;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Product> */
class ProductFactory extends Factory
{
    public function definition(): array
    {
        return [
            'category_id' => Category::factory(),
            'tax_rate_id' => TaxRate::factory(),
            'name' => ucwords(fake()->words(3, true)),
        ];
    }

    public function perishable(): static
    {
        return $this->state(fn () => ['track_batches' => true, 'track_expiry' => true]);
    }
}
