<?php

namespace Database\Seeders;

use App\Models\Role;
use App\Models\Store;
use App\Models\User;
use Illuminate\Database\Seeder;
use RuntimeException;

/** Creates the store and the first owner account (once). */
class StoreAndOwnerSeeder extends Seeder
{
    public function run(): void
    {
        Store::firstOrCreate(
            ['code' => config('compriva.seed.store_code')],
            ['name' => config('compriva.seed.store_name'), 'timezone' => config('compriva.timezone')],
        );

        $username = config('compriva.seed.owner_username');

        if (User::where('username', $username)->exists()) {
            return;
        }

        $password = config('compriva.seed.owner_password');

        if (blank($password)) {
            if (! app()->environment('local', 'testing')) {
                throw new RuntimeException('Set COMPRIVA_OWNER_PASSWORD before seeding outside the local environment.');
            }
            $password = 'password';
        }

        $owner = User::create(['name' => 'Store Owner', 'username' => $username, 'password' => $password]);
        $owner->roles()->attach(Role::where('name', 'owner')->value('id'));
    }
}
