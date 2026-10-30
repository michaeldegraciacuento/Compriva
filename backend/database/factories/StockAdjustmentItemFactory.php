<?php

namespace Database\Factories;

use App\Models\ProductSku;
use App\Models\StockAdjustment;
use App\Models\StockAdjustmentItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<StockAdjustmentItem> */
class StockAdjustmentItemFactory extends Factory
{
    public function definition(): array
    {
        return [
            'stock_adjustment_id' => StockAdjustment::factory(),
            'product_sku_id' => ProductSku::factory(),
            'system_quantity' => '10.0000',
            'counted_quantity' => '8.0000',
            'quantity_change' => '-2.0000',
            'unit_cost' => '20.0000',
        ];
    }
}
