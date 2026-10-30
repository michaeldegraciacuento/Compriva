<?php

namespace App\Domain\Identity\Actions;

use App\Models\User;
use App\Support\Audit\AuditLogger;

/**
 * Sets a new password and signs the user out of every other session and token.
 * Used for both self-service changes and admin resets (where nothing is kept).
 */
class ChangePassword
{
    public function __construct(
        private readonly RevokeUserAccess $revokeAccess,
        private readonly AuditLogger $audit,
    ) {}

    public function execute(User $user, string $password, ?int $keepTokenId = null, ?string $keepSessionId = null, bool $byAdmin = false): void
    {
        $user->forceFill(['password' => $password])->save();

        $this->revokeAccess->execute($user, $keepTokenId, $keepSessionId);

        $this->audit->record($byAdmin ? 'user.password_reset' : 'auth.password_changed', $user);
    }
}
