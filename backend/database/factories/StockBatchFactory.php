<?php

namespace Database\Factories;

use App\Models\ProductSku;
use App\Models\StockBatch;
use App\Models\Store;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<StockBatch> */
class StockBatchFactory extends Factory
{
    public function definition(): array
    {
        return [
            'store_id' => Store::factory(),
            'product_sku_id' => ProductSku::factory(),
            'batch_number' => fake()->unique()->bothify('LOT-####??'),
            'expiry_date' => now()->addDays(fake()->numberBetween(5, 180))->toDateString(),
            'unit_cost' => '20.0000',
            'initial_quantity' => '50.0000',
            'remaining_quantity' => '50.0000',
            'received_at' => now(),
        ];
    }
}
