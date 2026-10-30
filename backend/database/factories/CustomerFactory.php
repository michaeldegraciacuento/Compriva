<?php

namespace Database\Factories;

use App\Models\Customer;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Customer> */
class CustomerFactory extends Factory
{
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->bothify('C-#####'),
            'name' => fake()->name(),
            'phone' => fake()->numerify('09## ### ####'),
            'email' => fake()->safeEmail(),
        ];
    }

    public function seniorCitizen(): static
    {
        return $this->state(fn () => [
            'type' => 'senior_citizen',
            'id_number' => fake()->bothify('SC-####-#####'),
            'birth_date' => fake()->dateTimeBetween('-90 years', '-60 years'),
        ]);
    }
}
