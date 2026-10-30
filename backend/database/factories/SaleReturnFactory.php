<?php

namespace Database\Factories;

use App\Models\Sale;
use App\Models\SaleReturn;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<SaleReturn> */
class SaleReturnFactory extends Factory
{
    public function definition(): array
    {
        return [
            'id' => (string) Str::uuid7(),
            'sale_id' => Sale::factory(),
            'store_id' => fn (array $a) => Sale::find($a['sale_id'])->store_id,
            'device_id' => fn (array $a) => Sale::find($a['sale_id'])->device_id,
            'processed_by' => fn (array $a) => Sale::find($a['sale_id'])->cashier_id,
            'return_number' => fake()->unique()->numerify('RET-######'),
            'reason' => 'Damaged packaging',
            'subtotal' => '56.0000',
            'vat_amount' => '6.0000',
            'total_refund' => '56.0000',
            'occurred_at' => now(),
            'business_date' => now('Asia/Manila')->toDateString(),
        ];
    }
}
