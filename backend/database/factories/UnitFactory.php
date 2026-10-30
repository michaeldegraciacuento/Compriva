<?php

namespace Database\Factories;

use App\Models\Unit;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Unit> */
class UnitFactory extends Factory
{
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->bothify('u??##'),
            'name' => 'Piece',
            'type' => 'count',
            'allows_decimal' => false,
        ];
    }

    /** Weighed goods (kg). */
    public function weight(): static
    {
        return $this->state(fn () => ['name' => 'Kilogram', 'type' => 'weight', 'allows_decimal' => true]);
    }
}
