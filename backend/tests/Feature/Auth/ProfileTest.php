<?php

namespace Tests\Feature\Auth;

use Illuminate\Support\Facades\Hash;

/** The signed-in user's own profile, password, PIN and tokens. */
class ProfileTest extends AuthTestCase
{
    public function test_me_returns_the_user_roles_and_effective_permissions(): void
    {
        $cashier = $this->userWithRole('cashier');

        $this->actingAsUser($cashier)->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.user.username', $cashier->username)
            ->assertJsonPath('data.user.roles.0.name', 'cashier')
            ->assertJsonPath('data.auth.method', 'token')
            ->assertJsonFragment(['pos.access'])
            ->assertJsonMissing(['users.manage']);
    }

    public function test_profile_update_changes_name_and_email_only(): void
    {
        $user = $this->userWithRole('cashier', ['username' => 'ana']);

        $this->actingAsUser($user)->patchJson('/api/v1/auth/profile', ['name' => 'Ana R.', 'email' => 'ana@example.com', 'username' => 'hacker'])
            ->assertOk()
            ->assertJsonPath('data.user.name', 'Ana R.');

        $this->assertSame('ana', $user->fresh()->username);
    }

    public function test_password_change_requires_current_password_and_policy(): void
    {
        $user = $this->userWithRole('cashier', ['password' => 'Secret123']);
        $this->actingAsUser($user);

        $this->assertErrorCode($this->putJson('/api/v1/auth/password', [
            'current_password' => 'wrong', 'password' => 'NewSecret456', 'password_confirmation' => 'NewSecret456',
        ]), 422, 'VALIDATION_FAILED')->assertJsonStructure(['error' => ['details' => ['fields' => ['current_password']]]]);

        $this->assertErrorCode($this->putJson('/api/v1/auth/password', [
            'current_password' => 'Secret123', 'password' => 'short', 'password_confirmation' => 'short',
        ]), 422, 'VALIDATION_FAILED');
    }

    public function test_password_change_signs_out_other_tokens_but_keeps_the_current_one(): void
    {
        $user = $this->userWithRole('cashier', ['password' => 'Secret123']);
        $user->createToken('other-terminal');
        $current = $this->tokenFor($user);

        $this->withToken($current)->putJson('/api/v1/auth/password', [
            'current_password' => 'Secret123', 'password' => 'NewSecret456', 'password_confirmation' => 'NewSecret456',
        ])->assertNoContent();

        $this->assertTrue(Hash::check('NewSecret456', $user->fresh()->password));
        $this->assertSame(1, $user->tokens()->count());
        $this->resetAuth();
        $this->withToken($current)->getJson('/api/v1/auth/me')->assertOk();
    }

    public function test_pin_policy_and_hashing(): void
    {
        $user = $this->userWithRole('cashier', ['password' => 'Secret123']);
        $this->actingAsUser($user);

        foreach (['1234', '123456', '111111', '987654', '12345a'] as $weak) {
            $this->putJson('/api/v1/auth/pin', ['current_password' => 'Secret123', 'pin' => $weak, 'pin_confirmation' => $weak])
                ->assertUnprocessable();
        }

        $this->putJson('/api/v1/auth/pin', ['current_password' => 'Secret123', 'pin' => '482916', 'pin_confirmation' => '482916'])
            ->assertNoContent();
        $this->assertTrue(Hash::check('482916', $user->fresh()->pin_hash));
    }

    public function test_users_list_and_revoke_only_their_own_tokens(): void
    {
        $user = $this->userWithRole('cashier');
        $other = $this->userWithRole('cashier');
        $otherToken = $other->createToken('x')->accessToken;
        $old = $user->createToken('old-terminal')->accessToken;

        $this->actingAsUser($user)->getJson('/api/v1/auth/tokens')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonMissingPath('data.0.token');

        $this->deleteJson("/api/v1/auth/tokens/{$old->id}")->assertNoContent();
        $this->assertErrorCode($this->deleteJson("/api/v1/auth/tokens/{$otherToken->id}"), 404, 'NOT_FOUND');
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $otherToken->id]);
    }

    public function test_token_logout_revokes_only_that_token(): void
    {
        $user = $this->userWithRole('cashier');
        $token = $this->tokenFor($user);
        $user->createToken('another');

        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertNoContent();

        $this->resetAuth();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->assertSame(1, $user->tokens()->count());
    }
}
