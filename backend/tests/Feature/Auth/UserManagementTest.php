<?php

namespace Tests\Feature\Auth;

use App\Models\AuditLog;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class UserManagementTest extends AuthTestCase
{
    private function roleId(string $name): string
    {
        return Role::where('name', $name)->value('id');
    }

    public function test_owner_creates_a_cashier_with_hashed_credentials(): void
    {
        $owner = $this->userWithRole('owner');

        $response = $this->actingAsUser($owner)->postJson('/api/v1/users', [
            'name' => 'Juan Dela Cruz', 'username' => 'juan', 'password' => 'Secret123', 'password_confirmation' => 'Secret123',
            'pin' => '482916', 'roles' => [$this->roleId('cashier')],
        ])->assertCreated()
            ->assertJsonPath('data.username', 'juan')
            ->assertJsonPath('data.has_pin', true)
            ->assertJsonPath('data.roles.0.name', 'cashier');

        $this->assertArrayNotHasKey('password', $response->json('data'));
        $this->assertArrayNotHasKey('pin_hash', $response->json('data'));

        $juan = User::where('username', 'juan')->first();
        $this->assertTrue(Hash::check('Secret123', $juan->password));
        $this->assertTrue(Hash::check('482916', $juan->pin_hash));
        $this->assertDatabaseHas('audit_logs', ['event' => 'user.created', 'auditable_id' => $juan->id]);
    }

    public function test_validation_rejects_duplicates_and_weak_pins(): void
    {
        $owner = $this->userWithRole('owner', ['username' => 'boss']);

        $this->actingAsUser($owner)->postJson('/api/v1/users', [
            'name' => 'X', 'username' => 'boss', 'password' => 'Secret123', 'password_confirmation' => 'Secret123',
            'pin' => '123456', 'roles' => [],
        ])->assertUnprocessable()
            ->assertJsonStructure(['error' => ['details' => ['fields' => ['username', 'pin', 'roles']]]]);
    }

    public function test_manager_cannot_create_or_promote_to_owner(): void
    {
        $manager = $this->userWithRole('manager');
        $cashier = $this->userWithRole('cashier');

        $this->assertErrorCode($this->actingAsUser($manager)->postJson('/api/v1/users', [
            'name' => 'Evil', 'username' => 'evil', 'password' => 'Secret123', 'password_confirmation' => 'Secret123',
            'roles' => [$this->roleId('owner')],
        ]), 403, 'FORBIDDEN');

        $this->assertErrorCode(
            $this->actingAsUser($manager)->putJson("/api/v1/users/{$cashier->id}/roles", ['roles' => [$this->roleId('owner')]]),
            403, 'FORBIDDEN',
        );

        // Within their own permissions it works.
        $this->actingAsUser($manager)->putJson("/api/v1/users/{$cashier->id}/roles", ['roles' => [$this->roleId('inventory_clerk')]])
            ->assertOk()->assertJsonPath('data.roles.0.name', 'inventory_clerk');
    }

    public function test_manager_cannot_manage_the_owner(): void
    {
        $manager = $this->userWithRole('manager');
        $owner = $this->userWithRole('owner');

        $this->assertErrorCode($this->actingAsUser($manager)->postJson("/api/v1/users/{$owner->id}/suspend"), 403, 'FORBIDDEN');
        $this->assertErrorCode($this->actingAsUser($manager)->putJson("/api/v1/users/{$owner->id}/credentials", [
            'password' => 'Hijack123', 'password_confirmation' => 'Hijack123',
        ]), 403, 'FORBIDDEN');
        $this->assertTrue($owner->fresh()->is_active);
    }

    public function test_nobody_can_suspend_themselves_or_the_last_owner(): void
    {
        $owner = $this->userWithRole('owner');

        $this->assertErrorCode($this->actingAsUser($owner)->postJson("/api/v1/users/{$owner->id}/suspend"), 409, 'BUSINESS_RULE_VIOLATION')
            ->assertJsonPath('error.details.reason', 'self');

        $secondOwner = $this->userWithRole('owner');
        $this->actingAsUser($secondOwner)->postJson("/api/v1/users/{$owner->id}/suspend")->assertOk();

        // $secondOwner is now the last active owner: cannot lose the owner role.
        $this->assertErrorCode(
            $this->actingAsUser($secondOwner)->putJson("/api/v1/users/{$secondOwner->id}/roles", ['roles' => [$this->roleId('manager')]]),
            409, 'BUSINESS_RULE_VIOLATION',
        )->assertJsonPath('error.details.reason', 'last_owner');
    }

    public function test_suspension_signs_the_user_out_everywhere_and_activation_restores_access(): void
    {
        $owner = $this->userWithRole('owner');
        $cashier = $this->userWithRole('cashier', ['password' => 'Secret123']);
        $cashierToken = $this->tokenFor($cashier);
        DB::table('sessions')->insert(['id' => 'sess-1', 'user_id' => $cashier->id, 'payload' => '', 'last_activity' => time()]);

        $this->actingAsUser($owner)->postJson("/api/v1/users/{$cashier->id}/suspend", ['reason' => 'Cash shortage investigation'])
            ->assertOk()->assertJsonPath('data.is_active', false);

        $this->assertSame(0, $cashier->tokens()->count());
        $this->assertDatabaseMissing('sessions', ['id' => 'sess-1']);
        $this->resetAuth();
        $this->withToken($cashierToken)->getJson('/api/v1/auth/me')->assertUnauthorized();

        $this->actingAsUser($owner)->postJson("/api/v1/users/{$cashier->id}/activate")->assertOk()->assertJsonPath('data.is_active', true);
        $this->assertTrue(AuditLog::where('event', 'user.suspended')->exists());
    }

    public function test_admin_credential_reset_revokes_access_and_works(): void
    {
        $owner = $this->userWithRole('owner');
        $cashier = $this->userWithRole('cashier');
        $cashier->createToken('terminal');

        $this->actingAsUser($owner)->putJson("/api/v1/users/{$cashier->id}/credentials", [
            'password' => 'Reset1234', 'password_confirmation' => 'Reset1234', 'pin' => '739215',
        ])->assertNoContent();

        $cashier->refresh();
        $this->assertTrue(Hash::check('Reset1234', $cashier->password));
        $this->assertTrue(Hash::check('739215', $cashier->pin_hash));
        $this->assertSame(0, $cashier->tokens()->count());
    }

    public function test_users_can_be_filtered(): void
    {
        $owner = $this->userWithRole('owner', ['name' => 'Owner']);
        $this->userWithRole('cashier', ['name' => 'Ana Reyes']);
        $this->userWithRole('cashier', ['name' => 'Ben Cruz', 'is_active' => false]);

        $this->actingAsUser($owner)->getJson('/api/v1/users?role=cashier&status=active')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Ana Reyes')
            ->assertJsonPath('meta.total', 1);

        $this->getJson('/api/v1/users?q=cruz')->assertJsonCount(1, 'data');
    }
}
