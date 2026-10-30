<?php

namespace App\Http\Resources\V1\Identity;

use App\Http\Resources\V1\Devices\DeviceResource;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The signed-in user with their effective permissions and how they are
 * authenticated. Returned by login, terminal login and GET /auth/me.
 *
 * Permissions are sent so the UI can hide what the user cannot do; every
 * endpoint still checks them on the server.
 *
 * @mixin User
 */
class AuthSessionResource extends JsonResource
{
    /** @param  array<string, mixed>  $extra  e.g. a newly issued token */
    public function __construct(User $user, private readonly array $extra = [])
    {
        parent::__construct($user);
    }

    public function toArray(Request $request): array
    {
        $token = $this->resource->currentAccessToken();
        $isToken = $token instanceof PersonalAccessToken;
        $device = $isToken ? $token->device : null;

        return [
            'user' => new UserResource($this->resource->loadMissing('roles')),
            'permissions' => $this->resource->permissionNames()->values(),
            'auth' => [
                'method' => $isToken || isset($this->extra['token']) ? 'token' : 'session',
                'device' => $device ? new DeviceResource($device) : null,
                'expires_at' => $isToken ? $token->expires_at?->toIso8601ZuluString() : null,
            ],
            ...$this->extra,
        ];
    }
}
