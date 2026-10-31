<?php

namespace App\Domain\Identity\Queries;

use App\Domain\Settings\Settings;
use App\Models\User;

/**
 * The offline sign-in snapshot a terminal stores locally: every active user
 * allowed to use the POS who has a PIN, with the bcrypt PIN hash and their
 * permissions. Never includes passwords.
 *
 * The snapshot expires after COMPRIVA_SYNC_MAX_OFFLINE_HOURS; terminals must
 * refresh it to keep offline sign-in working, and suspended users disappear
 * from it at the next refresh (docs/README.md).
 */
class TerminalCashiers
{
    /** @return array{cashiers: list<array<string, mixed>>, generated_at: string, valid_until: string} */
    public function get(): array
    {
        $users = User::active()
            ->withPermission('pos.access')
            ->whereNotNull('pin_hash')
            ->with('roles.permissions')
            ->orderBy('name')
            ->get();

        return [
            'cashiers' => $users->map(fn (User $user) => [
                'id' => $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'pin_hash' => $user->pin_hash,
                'roles' => $user->roles->pluck('name')->sort()->values()->all(),
                'permissions' => $user->roles->flatMap->permissions->pluck('name')->unique()->sort()->values()->all(),
                'updated_at' => $user->updated_at?->toIso8601ZuluString(),
            ])->values()->all(),
            'generated_at' => now()->toIso8601ZuluString(),
            'valid_until' => now()->addHours((int) Settings::get('sync', 'max_offline_hours'))->toIso8601ZuluString(),
        ];
    }
}
