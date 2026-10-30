<?php

namespace Database\Factories;

use App\Models\Store;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Store> */
class StoreFactory extends Factory
{
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->bothify('ST###'),
            'name' => fake()->company().' Grocery',
            'tin' => fake()->numerify('###-###-###-000'),
            'address' => fake()->address(),
            'phone' => fake()->numerify('09## ### ####'),
        ];
    }
}
