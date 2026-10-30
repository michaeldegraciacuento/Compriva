<?php

namespace Database\Factories;

use App\Models\CashierShift;
use App\Models\Device;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<CashierShift> */
class CashierShiftFactory extends Factory
{
    /** An open shift. A terminal can have only one open shift at a time. */
    public function definition(): array
    {
        return [
            'device_id' => Device::factory()->active(),
            'store_id' => fn (array $attributes) => Device::find($attributes['device_id'])->store_id,
            'cashier_id' => User::factory(),
            'status' => 'open',
            'opening_float' => '2000.0000',
            'opened_at' => now()->subHours(4),
        ];
    }

    public function closed(): static
    {
        return $this->state(fn () => [
            'status' => 'closed',
            'expected_cash' => '2000.0000',
            'counted_cash' => '2000.0000',
            'cash_variance' => '0.0000',
            'closed_at' => now(),
        ]);
    }
}
