<?php

namespace Database\Factories;

use App\Models\StockAdjustment;
use App\Models\Store;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<StockAdjustment> */
class StockAdjustmentFactory extends Factory
{
    public function definition(): array
    {
        return [
            'store_id' => Store::factory(),
            'adjustment_number' => fake()->unique()->numerify('ADJ-######'),
            'reason' => 'count_correction',
            'created_by' => User::factory(),
        ];
    }
}
