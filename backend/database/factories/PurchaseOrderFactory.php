<?php

namespace Database\Factories;

use App\Models\PurchaseOrder;
use App\Models\Store;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<PurchaseOrder> */
class PurchaseOrderFactory extends Factory
{
    public function definition(): array
    {
        return [
            'store_id' => Store::factory(),
            'supplier_id' => Supplier::factory(),
            'po_number' => fake()->unique()->numerify('PO-######'),
            'order_date' => now()->toDateString(),
            'created_by' => User::factory(),
        ];
    }
}
