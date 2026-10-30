<?php

namespace Database\Factories;

use App\Models\Permission;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Permission> */
class PermissionFactory extends Factory
{
    public function definition(): array
    {
        $group = fake()->randomElement(['sales', 'inventory', 'products']);

        return [
            'name' => $group.'.'.fake()->unique()->word(),
            'display_name' => fake()->sentence(3),
            'group' => $group,
        ];
    }
}
