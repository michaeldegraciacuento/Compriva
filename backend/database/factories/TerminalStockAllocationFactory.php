<?php

namespace Database\Factories;

use App\Models\Device;
use App\Models\ProductSku;
use App\Models\TerminalStockAllocation;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<TerminalStockAllocation> */
class TerminalStockAllocationFactory extends Factory
{
    public function definition(): array
    {
        return [
            'device_id' => Device::factory()->active(),
            'store_id' => fn (array $a) => Device::find($a['device_id'])->store_id,
            'product_sku_id' => ProductSku::factory(),
            'allocated_quantity' => '20.0000',
        ];
    }
}
