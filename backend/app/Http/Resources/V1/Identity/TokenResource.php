<?php

namespace App\Http\Resources\V1\Identity;

use App\Models\PersonalAccessToken;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An API token, never including its secret.
 *
 * @mixin PersonalAccessToken
 */
class TokenResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $current = $request->user()?->currentAccessToken();

        return [
            'id' => $this->id,
            'name' => $this->name,
            'abilities' => $this->abilities,
            'device_id' => $this->device_id,
            'is_current' => $current instanceof PersonalAccessToken && $current->is($this->resource),
            'last_used_at' => $this->last_used_at?->toIso8601ZuluString(),
            'expires_at' => $this->expires_at?->toIso8601ZuluString(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
