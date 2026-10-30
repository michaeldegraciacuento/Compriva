<?php

namespace Tests\Feature\Auth;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as RouteFacade;

/** Backend permission enforcement; the UI hiding things is never relied on. */
class AuthorizationTest extends AuthTestCase
{
    private const PUBLIC_ROUTES = ['api.v1.health', 'api.v1.auth.login', 'api.v1.auth.token', 'api.v1.terminal.pair', 'api.v1.media.product-image', 'api.v1.media.payment-qr'];

    /** @return list<Route> */
    private function apiRoutes(): array
    {
        return collect(RouteFacade::getRoutes()->getRoutes())
            ->filter(fn (Route $route) => str_starts_with((string) $route->getName(), 'api.v1.'))
            ->values()->all();
    }

    public function test_every_non_public_route_requires_authentication_and_an_actor_check(): void
    {
        $routes = $this->apiRoutes();
        $this->assertGreaterThan(30, count($routes));

        foreach ($routes as $route) {
            if (in_array($route->getName(), self::PUBLIC_ROUTES, true)) {
                continue;
            }

            $middleware = $route->gatherMiddleware();
            $this->assertContains('auth:sanctum', $middleware, $route->getName());
            $this->assertTrue(
                in_array('actor.user', $middleware, true) || in_array('actor.device', $middleware, true),
                "{$route->getName()} has no actor check",
            );
        }
    }

    public function test_every_non_public_route_rejects_anonymous_requests(): void
    {
        foreach ($this->apiRoutes() as $route) {
            if (in_array($route->getName(), self::PUBLIC_ROUTES, true)) {
                continue;
            }

            $uri = preg_replace('/\{[^}]+\}/', '019a0000-0000-7000-8000-000000000000', $route->uri());
            $uri = str_replace('tokens/019a0000-0000-7000-8000-000000000000', 'tokens/1', $uri);
            $method = $route->methods()[0];

            $this->json($method, '/'.$uri)->assertStatus(401);
        }
    }

    /** @return array<string, array{0: string, 1: array<string, int>}> */
    public static function roleMatrix(): array
    {
        return [
            'owner' => ['owner', ['/api/v1/users' => 200, '/api/v1/roles' => 200, '/api/v1/devices' => 200]],
            'manager' => ['manager', ['/api/v1/users' => 200, '/api/v1/roles' => 403, '/api/v1/devices' => 403]],
            'cashier' => ['cashier', ['/api/v1/users' => 403, '/api/v1/roles' => 403, '/api/v1/devices' => 403]],
            'inventory_clerk' => ['inventory_clerk', ['/api/v1/users' => 403, '/api/v1/roles' => 403, '/api/v1/devices' => 403]],
        ];
    }

    /**
     * @param  array<string, int>  $expectations
     *
     * @dataProvider roleMatrix
     */
    public function test_role_access_matrix(string $role, array $expectations): void
    {
        $user = $this->userWithRole($role);

        foreach ($expectations as $uri => $status) {
            $response = $this->actingAsUser($user)->getJson($uri)->assertStatus($status);
            if ($status === 403) {
                $response->assertJsonPath('error.code', 'FORBIDDEN');
            }
        }
    }

    public function test_revoking_a_permission_takes_effect_on_the_next_request(): void
    {
        $manager = $this->userWithRole('manager');
        $this->actingAsUser($manager)->getJson('/api/v1/users')->assertOk();

        Role::where('name', 'manager')->first()->permissions()->detach(Permission::where('name', 'users.manage')->value('id'));

        $this->actingAsUser($manager)->getJson('/api/v1/users')->assertForbidden();
    }

    public function test_suspended_users_are_rejected_even_with_a_valid_token(): void
    {
        $owner = $this->userWithRole('owner');
        $token = $this->tokenFor($owner);
        $owner->forceFill(['is_active' => false])->save();

        $this->assertErrorCode($this->withToken($token)->getJson('/api/v1/auth/me'), 403, 'ACCOUNT_SUSPENDED');
    }

    public function test_device_tokens_cannot_act_as_people(): void
    {
        [$device, $token] = $this->pairedDevice();

        $this->withHeaders($this->terminalHeaders($device, $token));
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->getJson('/api/v1/users')->assertUnauthorized();
    }

    public function test_people_cannot_call_terminal_endpoints(): void
    {
        $owner = $this->userWithRole('owner');

        $this->assertErrorCode($this->actingAsUser($owner)->getJson('/api/v1/terminal/cashiers'), 401, 'DEVICE_NOT_REGISTERED');
    }
}
