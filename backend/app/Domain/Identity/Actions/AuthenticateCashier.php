<?php

namespace App\Domain\Identity\Actions;

use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;

/**
 * Online cashier sign-in at a paired terminal (username + PIN).
 *
 * Issues a short-lived token bound to the terminal (device_id). One session
 * per cashier per terminal: older tokens for the same pair are revoked.
 */
class AuthenticateCashier
{
    public const TOKEN_TTL_HOURS = 12;

    public function __construct(private readonly AuditLogger $audit) {}

    /** @return array{user: User, token: string, expires_at: Carbon} */
    public function execute(Device $device, string $username, string $pin): array
    {
        $user = User::where('username', $username)->first();

        // Always run one bcrypt check so response time does not reveal whether the user exists.
        $valid = Hash::check($pin, $user?->pin_hash ?? self::dummyHash()) && $user?->pin_hash !== null;

        if (! $user || ! $valid || ! $user->is_active || ! $user->hasPermission('pos.access')) {
            $this->audit->record('auth.terminal_login_failed', $user, new: ['username' => $username], user: $user, device: $device);

            // One message for every failure: unknown user, wrong PIN, suspended, not a cashier.
            throw new BusinessException('The username or PIN is incorrect, or this account cannot use the POS.', ErrorCode::InvalidCredentials, 401);
        }

        PersonalAccessToken::where('tokenable_type', $user->getMorphClass())
            ->where('tokenable_id', $user->id)
            ->where('device_id', $device->id)
            ->delete();

        $expiresAt = now()->addHours(self::TOKEN_TTL_HOURS);
        $token = $user->createToken("terminal:{$device->code}", [PersonalAccessToken::ABILITY_TERMINAL], $expiresAt);
        $token->accessToken->forceFill(['device_id' => $device->id])->save();

        $user->forceFill(['last_login_at' => now()])->save();
        $this->audit->record('auth.terminal_login', $user, user: $user, device: $device);

        return ['user' => $user, 'token' => $token->plainTextToken, 'expires_at' => $expiresAt];
    }

    private static function dummyHash(): string
    {
        static $hash;

        return $hash ??= Hash::make('compriva-timing-equaliser');
    }
}
