<?php

namespace App\Domain\Identity\Services;

use App\Models\Role;
use App\Models\User;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Collection;

/**
 * Rules that stop privilege escalation and lock-out:
 *
 * - Nobody can grant a permission they do not hold themselves.
 * - Nobody can manage a user who holds permissions they lack (a manager
 *   cannot suspend or reset the owner).
 * - The last active owner can never be suspended or lose the owner role.
 * - Nobody can suspend themselves or remove their own access.
 */
class AccessControl
{
    public const OWNER_ROLE = 'owner';

    /** @param  iterable<string>  $permissions */
    public function assertCanGrantPermissions(User $actor, iterable $permissions): void
    {
        $missing = collect($permissions)->diff($actor->permissionNames())->values();

        if ($missing->isNotEmpty()) {
            throw new AuthorizationException('You cannot grant permissions you do not have: '.$missing->implode(', '));
        }
    }

    /** @param  Collection<int, Role>  $roles */
    public function assertCanGrantRoles(User $actor, Collection $roles): void
    {
        $roles->loadMissing('permissions');

        $this->assertCanGrantPermissions($actor, $roles->flatMap->permissions->pluck('name')->unique());
    }

    public function assertCanManage(User $actor, User $target): void
    {
        if ($target->permissionNames()->diff($actor->permissionNames())->isNotEmpty()) {
            throw new AuthorizationException('You cannot manage a user with more access than you.');
        }
    }

    public function assertNotSelf(User $actor, User $target, string $action): void
    {
        if ($actor->is($target)) {
            throw new BusinessException("You cannot {$action} your own account.", ErrorCode::BusinessRuleViolation, 409, ['reason' => 'self']);
        }
    }

    /** Throws when $target is the last active owner and would stop being one. */
    public function assertKeepsAnOwner(User $target): void
    {
        if (! $target->hasRole(self::OWNER_ROLE)) {
            return;
        }

        $otherOwners = User::active()
            ->whereKeyNot($target->getKey())
            ->whereHas('roles', fn ($q) => $q->where('name', self::OWNER_ROLE))
            ->exists();

        if (! $otherOwners) {
            throw new BusinessException('The store must keep at least one active owner.', ErrorCode::BusinessRuleViolation, 409, ['reason' => 'last_owner']);
        }
    }
}
