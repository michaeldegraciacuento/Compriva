<?php

namespace Database\Factories;

use App\Models\ProductSku;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<PurchaseOrderItem> */
class PurchaseOrderItemFactory extends Factory
{
    public function definition(): array
    {
        return [
            'purchase_order_id' => PurchaseOrder::factory(),
            'product_sku_id' => ProductSku::factory(),
            'unit_id' => fn (array $attributes) => ProductSku::find($attributes['product_sku_id'])->base_unit_id,
            'quantity_ordered' => '10.0000',
            'unit_cost' => '50.0000',
            'line_total' => '500.0000',
        ];
    }
}
