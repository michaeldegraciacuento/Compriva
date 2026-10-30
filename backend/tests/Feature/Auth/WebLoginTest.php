<?php

namespace Tests\Feature\Auth;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

/** Web app sign-in with Sanctum session cookies. */
class WebLoginTest extends AuthTestCase
{
    private function login(string $login, string $password)
    {
        return $this->withHeaders(['Origin' => self::WEB_ORIGIN, 'Referer' => self::WEB_ORIGIN.'/login'])
            ->postJson('/api/v1/auth/login', ['login' => $login, 'password' => $password]);
    }

    public function test_user_signs_in_with_username_and_receives_session_and_permissions(): void
    {
        $user = $this->userWithRole('manager', ['username' => 'maria', 'password' => 'Secret123']);

        $this->login('maria', 'Secret123')
            ->assertOk()
            ->assertJsonPath('data.user.id', $user->id)
            ->assertJsonPath('data.auth.method', 'session')
            ->assertJsonFragment(['users.manage'])
            ->assertJsonMissingPath('data.user.password')
            ->assertJsonMissingPath('data.user.pin_hash');

        $this->assertAuthenticatedAs($user, 'web');
        $this->assertNotNull($user->fresh()->last_login_at);
    }

    public function test_user_can_sign_in_with_email(): void
    {
        $this->userWithRole('cashier', ['email' => 'ana@example.com', 'password' => 'Secret123']);

        $this->login('ana@example.com', 'Secret123')->assertOk();
    }

    public function test_wrong_password_and_unknown_user_are_indistinguishable(): void
    {
        $this->userWithRole('cashier', ['username' => 'ana', 'password' => 'Secret123']);

        $wrong = $this->assertErrorCode($this->login('ana', 'nope'), 401, 'INVALID_CREDENTIALS');
        $unknown = $this->assertErrorCode($this->login('nobody', 'nope'), 401, 'INVALID_CREDENTIALS');

        $this->assertSame($wrong->json('error.message'), $unknown->json('error.message'));
        $this->assertGuest('web');
        $this->assertSame(2, AuditLog::where('event', 'auth.login_failed')->count());
    }

    public function test_suspended_account_is_only_revealed_with_the_correct_password(): void
    {
        $this->userWithRole('cashier', ['username' => 'ana', 'password' => 'Secret123', 'is_active' => false]);

        $this->assertErrorCode($this->login('ana', 'wrong'), 401, 'INVALID_CREDENTIALS');
        $this->assertErrorCode($this->login('ana', 'Secret123'), 403, 'ACCOUNT_SUSPENDED');
        $this->assertGuest('web');
    }

    public function test_login_is_rate_limited_per_account(): void
    {
        $this->userWithRole('cashier', ['username' => 'ana', 'password' => 'Secret123']);

        for ($i = 0; $i < 5; $i++) {
            $this->login('ana', 'wrong')->assertUnauthorized();
        }

        $this->assertErrorCode($this->login('ana', 'Secret123'), 429, 'TOO_MANY_REQUESTS')
            ->assertHeader('Retry-After');
    }

    public function test_session_login_is_refused_without_the_web_app_origin(): void
    {
        $this->userWithRole('cashier', ['username' => 'ana', 'password' => 'Secret123']);

        $this->assertErrorCode($this->postJson('/api/v1/auth/login', ['login' => 'ana', 'password' => 'Secret123']), 400, 'BAD_REQUEST');
    }

    public function test_logout_ends_the_session(): void
    {
        $this->userWithRole('cashier', ['username' => 'ana', 'password' => 'Secret123']);
        $this->login('ana', 'Secret123')->assertOk();

        $this->withHeaders(['Origin' => self::WEB_ORIGIN])->postJson('/api/v1/auth/logout')->assertNoContent();

        $this->assertGuest('web');
        $this->assertDatabaseHas('audit_logs', ['event' => 'auth.logout']);
    }

    public function test_passwords_are_never_stored_in_plaintext(): void
    {
        $user = $this->userWithRole('cashier', ['password' => 'Secret123', 'pin_hash' => '482916']);
        $row = User::query()->toBase()->find($user->id);

        $this->assertNotSame('Secret123', $row->password);
        $this->assertNotSame('482916', $row->pin_hash);
        $this->assertTrue(Hash::check('Secret123', $row->password));
        $this->assertTrue(Hash::check('482916', $row->pin_hash));
        $this->assertStringStartsWith('$2y$', $row->password);
    }

    public function test_audit_log_never_contains_submitted_secrets(): void
    {
        $this->userWithRole('cashier', ['username' => 'ana', 'password' => 'Secret123']);
        $this->login('ana', 'TopSecretAttempt1');
        $this->login('ana', 'Secret123');

        $all = AuditLog::query()->toBase()->get()->toJson();
        $this->assertStringNotContainsString('TopSecretAttempt1', $all);
        $this->assertStringNotContainsString('Secret123', $all);
    }
}
