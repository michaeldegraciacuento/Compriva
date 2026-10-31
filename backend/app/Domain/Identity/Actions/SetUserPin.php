<?php

namespace App\Domain\Identity\Actions;

use App\Models\User;
use App\Support\Audit\AuditLogger;

/**
 * Sets (or clears) the PIN a cashier uses at terminals. Stored as a bcrypt
 * hash; terminals receive the hash for offline sign-in (docs/README.md).
 */
class SetUserPin
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function execute(User $user, ?string $pin, bool $byAdmin = false): void
    {
        $user->forceFill(['pin_hash' => $pin])->save();

        $this->audit->record($byAdmin ? 'user.pin_reset' : 'auth.pin_changed', $user, new: ['has_pin' => $pin !== null]);
    }
}
