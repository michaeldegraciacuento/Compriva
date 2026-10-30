<?php

namespace Database\Factories;

use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptItem;
use App\Models\ProductSku;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<GoodsReceiptItem> */
class GoodsReceiptItemFactory extends Factory
{
    public function definition(): array
    {
        return [
            'goods_receipt_id' => GoodsReceipt::factory(),
            'product_sku_id' => ProductSku::factory(),
            'unit_id' => fn (array $attributes) => ProductSku::find($attributes['product_sku_id'])->base_unit_id,
            'quantity' => '24.0000',
            'base_quantity' => '24.0000',
            'unit_cost' => '30.0000',
            'line_total' => '720.0000',
        ];
    }
}
