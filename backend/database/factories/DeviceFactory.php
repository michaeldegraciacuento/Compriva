<?php

namespace Database\Factories;

use App\Models\Device;
use App\Models\Store;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<Device> */
class DeviceFactory extends Factory
{
    public function definition(): array
    {
        return [
            'store_id' => Store::factory(),
            'code' => fake()->unique()->numerify('T##'),
            'name' => 'Checkout lane '.fake()->numberBetween(1, 20),
            'status' => 'pending',
        ];
    }

    /** Paired and allowed to sync. */
    public function active(): static
    {
        return $this->state(fn () => [
            'status' => 'active',
            'install_id' => (string) Str::uuid(),
            'machine_name' => 'POS-'.fake()->numerify('###'),
            'os' => 'windows',
            'app_version' => '0.1.0',
            'paired_at' => now(),
        ]);
    }

    public function revoked(): static
    {
        return $this->active()->state(fn () => ['status' => 'revoked', 'revoked_at' => now()]);
    }
}
