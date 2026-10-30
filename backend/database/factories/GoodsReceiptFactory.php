<?php

namespace Database\Factories;

use App\Models\GoodsReceipt;
use App\Models\Store;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<GoodsReceipt> */
class GoodsReceiptFactory extends Factory
{
    public function definition(): array
    {
        return [
            'store_id' => Store::factory(),
            'supplier_id' => Supplier::factory(),
            'receipt_number' => fake()->unique()->numerify('GR-######'),
            'received_at' => now(),
            'received_by' => User::factory(),
        ];
    }
}
