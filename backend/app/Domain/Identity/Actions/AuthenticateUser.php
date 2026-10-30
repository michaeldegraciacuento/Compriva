<?php

namespace App\Domain\Identity\Actions;

use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\Hash;

/**
 * Verifies a username/email + password.
 *
 * Unknown user and wrong password produce the same error and take the same
 * time (a dummy hash is checked), so accounts cannot be enumerated. Suspension
 * is only revealed after the correct password was given.
 */
class AuthenticateUser
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function execute(string $login, string $password): User
    {
        $user = User::query()
            ->where(fn ($q) => $q->where('username', $login)->orWhere('email', $login))
            ->first();

        $valid = Hash::check($password, $user?->password ?? self::dummyHash());

        if (! $user || ! $valid) {
            $this->audit->record('auth.login_failed', $user, new: ['login' => $login], user: $user);

            throw new BusinessException('The username or password is incorrect.', ErrorCode::InvalidCredentials, 401);
        }

        if (! $user->is_active) {
            $this->audit->record('auth.login_blocked', $user, user: $user);

            throw new BusinessException('This account is suspended. Contact your manager.', ErrorCode::AccountSuspended, 403);
        }

        $attributes = ['last_login_at' => now()];
        if (Hash::needsRehash($user->password)) {
            $attributes['password'] = $password; // re-hashed with current settings by the cast
        }
        $user->forceFill($attributes)->save();

        $this->audit->record('auth.login', $user, user: $user);

        return $user;
    }

    private static function dummyHash(): string
    {
        static $hash;

        return $hash ??= Hash::make('compriva-timing-equaliser');
    }
}
