<?php

namespace Tests\Feature\Auth;

use App\Domain\Devices\Actions\ManageDevices;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use Illuminate\Support\Str;

/** Terminal registration, pairing, device tokens, cashier sign-in and revocation. */
class DeviceAuthenticationTest extends AuthTestCase
{
    private function pair(string $code, ?string $installId = null)
    {
        $this->resetAuth();

        return $this->postJson('/api/v1/terminal/pair', [
            'pairing_code' => $code,
            'install_id' => $installId ?? (string) Str::uuid(),
            'machine_name' => 'POS-01',
            'os' => 'windows',
            'app_version' => '0.1.0',
        ]);
    }

    public function test_owner_registers_a_terminal_and_gets_a_one_time_pairing_code(): void
    {
        $owner = $this->userWithRole('owner');

        $response = $this->actingAsUser($owner)->postJson('/api/v1/devices', ['code' => 't03', 'name' => 'Lane 3'])
            ->assertCreated()
            ->assertJsonPath('data.device.code', 'T03')
            ->assertJsonPath('data.device.status', 'pending');

        $code = $response->json('data.pairing_code');
        $this->assertMatchesRegularExpression('/^[A-Z2-9]{4}-[A-Z2-9]{4}$/', $code);

        $device = Device::where('code', 'T03')->first();
        $this->assertSame(ManageDevices::hashCode($code), $device->pairing_code_hash);
        $this->assertStringNotContainsString(str_replace('-', '', $code), json_encode($device->getAttributes()) ?: '');
        $this->assertArrayNotHasKey('pairing_code_hash', $response->json('data.device'));
    }

    public function test_terminal_pairs_once_with_the_code(): void
    {
        [, $code] = app(ManageDevices::class)->register($this->store, 'T01', 'Lane 1');
        $installId = (string) Str::uuid();

        $response = $this->pair(strtolower($code), $installId)  // case and dash insensitive
            ->assertCreated()
            ->assertJsonPath('data.device.status', 'active')
            ->assertJsonPath('data.device.install_id', $installId);
        $this->assertNotEmpty($response->json('data.device_token'));

        $this->assertErrorCode($this->pair($code), 422, 'PAIRING_CODE_INVALID');
    }

    /**
     * Terminals authenticate with tokens, so their origins must never be Sanctum
     * "stateful" (that would demand a CSRF cookie the terminal never has).
     */
    public function test_terminal_origins_pair_without_csrf(): void
    {
        foreach (['T81' => 'http://localhost:1420', 'T82' => 'http://tauri.localhost'] as $terminalCode => $origin) {
            $this->assertNotContains(parse_url($origin, PHP_URL_HOST).(parse_url($origin, PHP_URL_PORT) ? ':'.parse_url($origin, PHP_URL_PORT) : ''), config('sanctum.stateful'));

            [, $code] = app(ManageDevices::class)->register($this->store, $terminalCode, 'Lane');
            $this->resetAuth();
            $this->withHeaders(['Origin' => $origin, 'Referer' => $origin.'/'])
                ->postJson('/api/v1/terminal/pair', ['pairing_code' => $code, 'install_id' => (string) Str::uuid()])
                ->assertCreated();
        }
    }

    public function test_expired_and_wrong_codes_are_rejected_and_pairing_is_rate_limited(): void
    {
        [$device, $code] = app(ManageDevices::class)->register($this->store, 'T01', 'Lane 1');
        $device->forceFill(['pairing_code_expires_at' => now()->subMinute()])->save();

        $this->assertErrorCode($this->pair($code), 422, 'PAIRING_CODE_INVALID');
        for ($i = 0; $i < 4; $i++) {
            $this->pair('WRNG-CODE')->assertUnprocessable();
        }
        // Limit is 5 per minute per IP: the 6th attempt is throttled.
        $this->assertErrorCode($this->pair('WRNG-CODE'), 429, 'TOO_MANY_REQUESTS');
    }

    public function test_one_installation_cannot_be_two_active_terminals(): void
    {
        $installId = (string) Str::uuid();
        [, $first] = app(ManageDevices::class)->register($this->store, 'T01', 'Lane 1');
        [, $second] = app(ManageDevices::class)->register($this->store, 'T02', 'Lane 2');

        $this->pair($first, $installId)->assertCreated();
        $this->assertErrorCode($this->pair($second, $installId), 409, 'CONFLICT')->assertJsonPath('error.details.device_code', 'T01');
    }

    public function test_device_token_requires_the_matching_install_id_header(): void
    {
        [$device, $token] = $this->pairedDevice();

        $this->withHeaders($this->terminalHeaders($device, $token))->getJson('/api/v1/terminal/device')
            ->assertOk()->assertJsonPath('data.code', $device->code);

        $this->resetAuth();
        $this->assertErrorCode(
            $this->withHeaders(['Authorization' => "Bearer {$token}", 'X-Compriva-Device' => (string) Str::uuid()])->getJson('/api/v1/terminal/device'),
            401, 'DEVICE_NOT_REGISTERED',
        );
    }

    public function test_cashier_signs_in_at_the_terminal_with_pin(): void
    {
        [$device, $deviceToken] = $this->pairedDevice('T01');
        $cashier = $this->userWithRole('cashier', ['username' => 'juan', 'pin_hash' => '482916']);

        $response = $this->withHeaders($this->terminalHeaders($device, $deviceToken))
            ->postJson('/api/v1/terminal/login', ['username' => 'juan', 'pin' => '482916'])
            ->assertOk()
            ->assertJsonPath('data.user.id', $cashier->id)
            ->assertJsonPath('data.auth.method', 'token')
            ->assertJsonFragment(['pos.access']);

        $token = PersonalAccessToken::findToken($response->json('data.token'));
        $this->assertSame($device->id, $token->device_id);
        $this->assertSame(['terminal'], $token->abilities);
        $this->assertTrue($token->expires_at->between(now()->addHours(11), now()->addHours(13)));

        // The cashier token works on this terminal only.
        $this->resetAuth();
        $this->withHeaders($this->terminalHeaders($device, $response->json('data.token')))->getJson('/api/v1/auth/me')
            ->assertOk()->assertJsonPath('data.auth.device.code', 'T01');
        $this->resetAuth();
        $this->assertErrorCode(
            $this->withToken($response->json('data.token'))->getJson('/api/v1/auth/me'),
            401, 'DEVICE_NOT_REGISTERED',
        );
    }

    public function test_cashier_sign_in_failures_look_identical(): void
    {
        [$device, $deviceToken] = $this->pairedDevice();
        $this->userWithRole('cashier', ['username' => 'juan', 'pin_hash' => '482916']);
        $this->userWithRole('cashier', ['username' => 'gone', 'pin_hash' => '482916', 'is_active' => false]);
        $this->userWithRole('inventory_clerk', ['username' => 'clerk', 'pin_hash' => '482916']);
        $this->userWithRole('cashier', ['username' => 'nopin']);

        $messages = collect([['juan', '000000'], ['nobody', '482916'], ['gone', '482916'], ['clerk', '482916'], ['nopin', '482916']])
            ->map(fn (array $c) => $this->assertErrorCode(
                $this->withHeaders($this->terminalHeaders($device, $deviceToken))->postJson('/api/v1/terminal/login', ['username' => $c[0], 'pin' => $c[1]]),
                401, 'INVALID_CREDENTIALS',
            )->json('error.message'));

        $this->assertCount(1, $messages->unique());
    }

    public function test_cashier_snapshot_for_offline_sign_in(): void
    {
        [$device, $deviceToken] = $this->pairedDevice();
        $cashier = $this->userWithRole('cashier', ['username' => 'juan', 'pin_hash' => '482916']);
        $this->userWithRole('cashier', ['username' => 'suspended', 'pin_hash' => '482916', 'is_active' => false]);
        $this->userWithRole('cashier', ['username' => 'nopin']);
        $this->userWithRole('inventory_clerk', ['username' => 'clerk', 'pin_hash' => '482916']);

        $response = $this->withHeaders($this->terminalHeaders($device, $deviceToken))->getJson('/api/v1/terminal/cashiers')
            ->assertOk()
            ->assertJsonCount(1, 'data.cashiers')
            ->assertJsonPath('data.cashiers.0.username', 'juan')
            ->assertJsonStructure(['data' => ['generated_at', 'valid_until', 'cashiers' => [['id', 'pin_hash', 'permissions', 'roles']]]]);

        $entry = $response->json('data.cashiers.0');
        $this->assertSame($cashier->fresh()->pin_hash, $entry['pin_hash']);
        $this->assertStringStartsWith('$2y$', $entry['pin_hash']);
        $this->assertArrayNotHasKey('password', $entry);
    }

    public function test_revoking_a_terminal_kills_its_device_and_cashier_tokens(): void
    {
        $owner = $this->userWithRole('owner');
        [$device, $deviceToken] = $this->pairedDevice();
        $this->userWithRole('cashier', ['username' => 'juan', 'pin_hash' => '482916']);
        $cashierToken = $this->withHeaders($this->terminalHeaders($device, $deviceToken))
            ->postJson('/api/v1/terminal/login', ['username' => 'juan', 'pin' => '482916'])->json('data.token');

        $this->actingAsUser($owner)->postJson("/api/v1/devices/{$device->id}/revoke")
            ->assertOk()->assertJsonPath('data.status', 'revoked');

        $this->assertSame(0, PersonalAccessToken::where('device_id', $device->id)->count());
        $this->resetAuth();
        $this->withHeaders($this->terminalHeaders($device, $deviceToken))->getJson('/api/v1/terminal/device')->assertUnauthorized();
        $this->resetAuth();
        $this->withHeaders($this->terminalHeaders($device, $cashierToken))->getJson('/api/v1/auth/me')->assertUnauthorized();

        // A revoked terminal cannot receive a new pairing code.
        $this->assertErrorCode($this->actingAsUser($owner)->postJson("/api/v1/devices/{$device->id}/pairing-code"), 409, 'CONFLICT');
    }
}
