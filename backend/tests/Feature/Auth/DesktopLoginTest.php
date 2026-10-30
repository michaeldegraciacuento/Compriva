<?php

namespace Tests\Feature\Auth;

use App\Models\PersonalAccessToken;

/** Desktop app sign-in: same account and password as the web app, returned as a token. */
class DesktopLoginTest extends AuthTestCase
{
    private function login(string $login, string $password)
    {
        $this->resetAuth();

        // The desktop app's origin is never a Sanctum stateful (cookie) domain.
        return $this->withHeaders(['Origin' => 'http://tauri.localhost'])
            ->postJson('/api/v1/auth/token', ['login' => $login, 'password' => $password, 'device_name' => 'POS-01']);
    }

    public function test_signs_in_with_username_or_email_and_password(): void
    {
        $cashier = $this->userWithRole('cashier', ['username' => 'juan', 'email' => 'juan@example.com', 'password' => 'Secret123']);

        $response = $this->login('juan', 'Secret123')
            ->assertOk()
            ->assertJsonPath('data.user.id', $cashier->id)
            ->assertJsonPath('data.auth.method', 'token')
            ->assertJsonFragment(['pos.access']);

        $token = PersonalAccessToken::findToken($response->json('data.token'));
        $this->assertSame('desktop:POS-01', $token->name);
        $this->assertTrue($token->expires_at->between(now()->addHours(11), now()->addHours(13)));

        $this->login('juan@example.com', 'Secret123')->assertOk();
    }

    public function test_the_token_signs_in_requests_and_logout_revokes_it(): void
    {
        $this->userWithRole('manager', ['username' => 'maria', 'password' => 'Secret123']);
        $token = $this->login('maria', 'Secret123')->json('data.token');

        $this->resetAuth();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.user.username', 'maria');
        $this->withToken($token)->getJson('/api/v1/users')->assertOk(); // manager permissions apply

        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertNoContent();
        $this->resetAuth();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public function test_same_rules_as_the_web_sign_in(): void
    {
        $this->userWithRole('cashier', ['username' => 'juan', 'password' => 'Secret123']);
        $this->userWithRole('cashier', ['username' => 'gone', 'password' => 'Secret123', 'is_active' => false]);

        $wrong = $this->assertErrorCode($this->login('juan', 'nope'), 401, 'INVALID_CREDENTIALS');
        $unknown = $this->assertErrorCode($this->login('nobody', 'nope'), 401, 'INVALID_CREDENTIALS');
        $this->assertSame($wrong->json('error.message'), $unknown->json('error.message'));

        $this->assertErrorCode($this->login('gone', 'Secret123'), 403, 'ACCOUNT_SUSPENDED');
        $this->assertSame(0, PersonalAccessToken::count());
    }

    public function test_is_rate_limited_like_the_web_sign_in(): void
    {
        $this->userWithRole('cashier', ['username' => 'juan', 'password' => 'Secret123']);

        for ($i = 0; $i < 5; $i++) {
            $this->login('juan', 'wrong')->assertUnauthorized();
        }

        $this->assertErrorCode($this->login('juan', 'Secret123'), 429, 'TOO_MANY_REQUESTS');
    }
}
