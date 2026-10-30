<?php

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Services\AccessControl;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use Illuminate\Support\Facades\DB;

/**
 * Activates or suspends an account. Suspension signs the user out everywhere
 * immediately (tokens and sessions); terminals drop the cashier at the next
 * cashier-list sync.
 */
class ChangeUserStatus
{
    public function __construct(
        private readonly AccessControl $access,
        private readonly RevokeUserAccess $revokeAccess,
        private readonly AuditLogger $audit,
    ) {}

    public function suspend(User $actor, User $user, ?string $reason = null): User
    {
        $this->access->assertNotSelf($actor, $user, 'suspend');
        $this->access->assertCanManage($actor, $user);
        $this->access->assertKeepsAnOwner($user);

        return DB::transaction(function () use ($user, $reason) {
            $user->forceFill(['is_active' => false])->save();
            $this->revokeAccess->execute($user);
            $this->audit->record('user.suspended', $user, ['is_active' => true], ['is_active' => false, 'reason' => $reason]);

            return $user;
        });
    }

    public function activate(User $actor, User $user): User
    {
        $this->access->assertCanManage($actor, $user);

        $user->forceFill(['is_active' => true])->save();
        $this->audit->record('user.activated', $user, ['is_active' => false], ['is_active' => true]);

        return $user;
    }
}
