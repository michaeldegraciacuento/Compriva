<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Laravel\Sanctum\PersonalAccessToken as SanctumPersonalAccessToken;

/**
 * Sanctum token with the terminal it was issued on (device_id).
 *
 * Abilities in use:
 *   device   — a terminal's own token (tokenable = Device), issued at pairing
 *   terminal — a cashier's session on a terminal (tokenable = User, device_id set)
 */
class PersonalAccessToken extends SanctumPersonalAccessToken
{
    public const ABILITY_DEVICE = 'device';

    public const ABILITY_TERMINAL = 'terminal';

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
