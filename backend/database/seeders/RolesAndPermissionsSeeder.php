<?php

namespace Database\Seeders;

use App\Domain\Identity\Permissions;
use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;

/** Syncs the code-defined permission catalog and system roles. Idempotent. */
class RolesAndPermissionsSeeder extends Seeder
{
    public function run(): void
    {
        foreach (Permissions::ALL as $name => [$displayName, $group]) {
            Permission::updateOrCreate(['name' => $name], ['display_name' => $displayName, 'group' => $group]);
        }

        // Permissions removed from the catalog are removed from the database.
        Permission::whereNotIn('name', array_keys(Permissions::ALL))->delete();

        $permissionIds = Permission::pluck('id', 'name');

        foreach (Permissions::ROLES as $name => [$displayName, $description]) {
            $role = Role::updateOrCreate(
                ['name' => $name],
                ['display_name' => $displayName, 'description' => $description, 'is_system' => true],
            );

            $role->permissions()->sync($permissionIds->only(Permissions::forRole($name))->values());
        }
    }
}
