<?php

namespace Database\Factories;

use App\Models\CashierShift;
use App\Models\CashMovement;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<CashMovement> */
class CashMovementFactory extends Factory
{
    public function definition(): array
    {
        return [
            'cashier_shift_id' => CashierShift::factory(),
            'type' => 'cash_drop',
            'amount' => '5000.0000',
            'reason' => 'Drawer above limit',
            'performed_by' => fn (array $attributes) => CashierShift::find($attributes['cashier_shift_id'])->cashier_id,
            'occurred_at' => now(),
        ];
    }
}
