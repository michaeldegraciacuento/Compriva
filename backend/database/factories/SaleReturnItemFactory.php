<?php

namespace Database\Factories;

use App\Models\SaleItem;
use App\Models\SaleReturn;
use App\Models\SaleReturnItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<SaleReturnItem> Returns one unit of the given sale item. */
class SaleReturnItemFactory extends Factory
{
    public function definition(): array
    {
        return [
            'sale_return_id' => SaleReturn::factory(),
            'sale_item_id' => SaleItem::factory(),
            'product_sku_id' => fn (array $a) => SaleItem::find($a['sale_item_id'])->product_sku_id,
            'quantity' => '1.0000',
            'base_quantity' => '1.0000',
            'unit_price' => fn (array $a) => SaleItem::find($a['sale_item_id'])->unit_price,
            'tax_amount' => '6.0000',
            'refund_amount' => fn (array $a) => $a['unit_price'],
        ];
    }
}
