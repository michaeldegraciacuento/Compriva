<?php

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Services\AccessControl;
use App\Domain\Sync\SyncChanges;
use App\Models\Role;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use Illuminate\Support\Facades\DB;

/**
 * Replaces a user's roles. The actor may only grant roles within their own
 * permissions, may not manage users with more access, and the last owner
 * keeps the owner role.
 */
class SyncUserRoles
{
    public function __construct(
        private readonly AccessControl $access,
        private readonly AuditLogger $audit,
    ) {}

    /** @param  list<string>  $roleIds */
    public function execute(User $actor, User $user, array $roleIds): User
    {
        $roles = Role::whereKey($roleIds)->get();

        $this->access->assertCanManage($actor, $user);
        $this->access->assertCanGrantRoles($actor, $roles);
        if (! $roles->contains('name', AccessControl::OWNER_ROLE)) {
            $this->access->assertKeepsAnOwner($user);
        }

        return DB::transaction(function () use ($user, $roles) {
            $before = $user->roles()->pluck('name')->sort()->values()->all();
            $user->roles()->sync($roles->modelKeys());
            $user->flushPermissionCache();
            SyncChanges::cashiers($user->id); // terminals refresh their offline cashier list

            $this->audit->record('user.roles_changed', $user, ['roles' => $before], ['roles' => $roles->pluck('name')->sort()->values()->all()]);

            return $user;
        });
    }
}
