<?php

namespace Tests\Feature\Auth;

use App\Domain\Identity\Permissions;
use App\Models\Permission;
use App\Models\Role;

class RoleManagementTest extends AuthTestCase
{
    public function test_owner_lists_permissions_and_roles(): void
    {
        $owner = $this->userWithRole('owner');

        $this->actingAsUser($owner)->getJson('/api/v1/permissions')
            ->assertOk()->assertJsonCount(count(Permissions::ALL), 'data');

        $this->getJson('/api/v1/roles')
            ->assertOk()
            ->assertJsonCount(4, 'data')
            ->assertJsonStructure(['data' => [['id', 'name', 'permissions', 'users_count', 'is_system']]]);
    }

    public function test_owner_creates_updates_and_deletes_a_custom_role(): void
    {
        $owner = $this->userWithRole('owner');

        $id = $this->actingAsUser($owner)->postJson('/api/v1/roles', [
            'name' => 'supervisor', 'display_name' => 'Supervisor', 'permissions' => ['pos.access', 'sales.void'],
        ])->assertCreated()->assertJsonPath('data.permissions', ['pos.access', 'sales.void'])->json('data.id');

        $this->patchJson("/api/v1/roles/{$id}", ['display_name' => 'Shift supervisor'])
            ->assertOk()->assertJsonPath('data.display_name', 'Shift supervisor');

        $this->putJson("/api/v1/roles/{$id}/permissions", ['permissions' => ['pos.access', 'sales.void', 'sales.return']])
            ->assertOk()->assertJsonCount(3, 'data.permissions');

        $this->deleteJson("/api/v1/roles/{$id}")->assertNoContent();
        $this->assertDatabaseMissing('roles', ['id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['event' => 'role.permissions_changed']);
    }

    public function test_owner_role_and_system_roles_are_protected(): void
    {
        $owner = $this->userWithRole('owner');
        $ownerRole = Role::where('name', 'owner')->first();
        $cashierRole = Role::where('name', 'cashier')->first();

        $this->assertErrorCode(
            $this->actingAsUser($owner)->putJson("/api/v1/roles/{$ownerRole->id}/permissions", ['permissions' => ['pos.access']]),
            409, 'BUSINESS_RULE_VIOLATION',
        );
        $this->assertErrorCode($this->deleteJson("/api/v1/roles/{$cashierRole->id}"), 409, 'BUSINESS_RULE_VIOLATION');
        $this->assertSame(count(Permissions::ALL), $ownerRole->permissions()->count());
    }

    public function test_role_in_use_cannot_be_deleted(): void
    {
        $owner = $this->userWithRole('owner');
        $role = Role::create(['name' => 'temp', 'display_name' => 'Temp']);
        $this->userWithRole('temp');

        $this->assertErrorCode($this->actingAsUser($owner)->deleteJson("/api/v1/roles/{$role->id}"), 409, 'CONFLICT');
    }

    public function test_unknown_permissions_are_rejected(): void
    {
        $owner = $this->userWithRole('owner');

        $this->actingAsUser($owner)->postJson('/api/v1/roles', [
            'name' => 'x', 'display_name' => 'X', 'permissions' => ['everything.forever'],
        ])->assertUnprocessable();
    }

    public function test_role_managers_cannot_grant_permissions_they_lack(): void
    {
        // A delegated role admin who can manage roles but not see profit reports.
        $delegate = Role::create(['name' => 'role_admin', 'display_name' => 'Role admin']);
        $delegate->permissions()->sync(Permission::whereIn('name', ['roles.manage', 'pos.access'])->pluck('id'));
        $admin = $this->userWithRole('role_admin');
        $cashierRole = Role::where('name', 'cashier')->first();

        $this->assertErrorCode($this->actingAsUser($admin)->postJson('/api/v1/roles', [
            'name' => 'sneaky', 'display_name' => 'Sneaky', 'permissions' => ['reports.view_profit'],
        ]), 403, 'FORBIDDEN');

        $this->assertErrorCode(
            $this->actingAsUser($admin)->putJson("/api/v1/roles/{$cashierRole->id}/permissions", [
                'permissions' => [...$cashierRole->permissions()->pluck('name'), 'reports.view_profit'],
            ]),
            403, 'FORBIDDEN',
        );
    }
}
