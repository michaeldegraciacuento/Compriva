<?php

namespace Database\Factories;

use App\Models\ProductSku;
use App\Models\StockMovement;
use App\Models\Store;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<StockMovement> */
class StockMovementFactory extends Factory
{
    public function definition(): array
    {
        return [
            'store_id' => Store::factory(),
            'product_sku_id' => ProductSku::factory(),
            'type' => 'opening_balance',
            'quantity' => '10.0000',
            'unit_cost' => '20.0000',
            'occurred_at' => now(),
        ];
    }
}
