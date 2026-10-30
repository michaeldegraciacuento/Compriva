<?php

namespace Database\Factories;

use App\Models\InventoryLevel;
use App\Models\ProductSku;
use App\Models\Store;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<InventoryLevel> */
class InventoryLevelFactory extends Factory
{
    public function definition(): array
    {
        return [
            'store_id' => Store::factory(),
            'product_sku_id' => ProductSku::factory(),
            'quantity_on_hand' => '100.0000',
            'average_cost' => '25.0000',
        ];
    }
}
