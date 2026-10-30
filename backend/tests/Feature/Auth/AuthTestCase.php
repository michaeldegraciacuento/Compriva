<?php

namespace Tests\Feature\Auth;

use App\Domain\Devices\Actions\ManageDevices;
use App\Domain\Devices\Actions\PairDevice;
use App\Models\Device;
use App\Models\Role;
use App\Models\Store;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

abstract class AuthTestCase extends TestCase
{
    use RefreshDatabase;

    /** Origin of the web app; makes Sanctum treat the request as stateful (cookie auth). */
    protected const WEB_ORIGIN = 'http://localhost:3000';

    protected Store $store;

    /** Deterministic terminal codes (random ones can collide). */
    private int $deviceSequence = 50;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RolesAndPermissionsSeeder::class);
        $this->store = Store::factory()->create();
    }

    /** @param  array<string, mixed>  $attributes */
    protected function userWithRole(string $role, array $attributes = []): User
    {
        $user = User::factory()->create($attributes);
        $user->roles()->attach(Role::where('name', $role)->value('id'));

        return $user;
    }

    protected function tokenFor(User $user): string
    {
        return $user->createToken('test')->plainTextToken;
    }

    /** Sends the next request(s) as $user with a fresh bearer token. */
    protected function actingAsUser(User $user): static
    {
        $this->resetAuth();

        return $this->withToken($this->tokenFor($user));
    }

    /** Laravel caches the resolved user on the guard; clear it between identities. */
    protected function resetAuth(): void
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
    }

    /** Registers and pairs a terminal. @return array{0: Device, 1: string} device and device token */
    protected function pairedDevice(?string $code = null): array
    {
        [$device, $pairingCode] = app(ManageDevices::class)->register($this->store, $code ?? sprintf('T%02d', ++$this->deviceSequence), 'Lane');

        return app(PairDevice::class)->execute($pairingCode, ['install_id' => (string) Str::uuid()]);
    }

    /** @return array<string, string> */
    protected function terminalHeaders(Device $device, string $token): array
    {
        return ['Authorization' => "Bearer {$token}", 'X-Compriva-Device' => (string) $device->install_id];
    }

    protected function assertErrorCode(TestResponse $response, int $status, string $code): TestResponse
    {
        return $response->assertStatus($status)->assertJsonPath('error.code', $code);
    }
}
