<?php

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Permissions;
use App\Domain\Identity\Services\AccessControl;
use App\Domain\Sync\SyncChanges;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Creates roles, edits them, replaces their permissions and deletes them.
 *
 * The owner role always holds every permission and cannot be edited. System
 * roles cannot be deleted. A role in use cannot be deleted.
 */
class SaveRole
{
    public function __construct(
        private readonly AccessControl $access,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  array{name: string, display_name: string, description?: ?string}  $data
     * @param  list<string>  $permissions
     */
    public function create(User $actor, array $data, array $permissions): Role
    {
        $this->access->assertCanGrantPermissions($actor, $permissions);

        return DB::transaction(function () use ($data, $permissions) {
            $role = Role::create([...$data, 'is_system' => false]);
            $role->permissions()->sync(Permission::whereIn('name', $permissions)->pluck('id'));

            $this->audit->record('role.created', $role, new: ['name' => $role->name, 'permissions' => $permissions]);

            return $role;
        });
    }

    /** @param  array{display_name?: string, description?: ?string}  $data */
    public function update(Role $role, array $data): Role
    {
        $before = $role->only(array_keys($data));
        $role->update($data);
        $this->audit->record('role.updated', $role, $before, $data);

        return $role;
    }

    /** @param  list<string>  $permissions */
    public function syncPermissions(User $actor, Role $role, array $permissions): Role
    {
        if ($role->name === AccessControl::OWNER_ROLE) {
            throw new BusinessException('The owner role always has every permission.', ErrorCode::BusinessRuleViolation, 409, ['reason' => 'owner_role']);
        }

        $before = $role->permissions()->pluck('name');
        // Only changes need to be within the actor's own permissions.
        $this->access->assertCanGrantPermissions($actor, collect($permissions)->diff($before));
        $this->access->assertCanGrantPermissions($actor, $before->diff($permissions));

        $unknown = array_diff($permissions, array_keys(Permissions::ALL));
        if ($unknown !== []) {
            throw new BusinessException('Unknown permissions: '.implode(', ', $unknown), ErrorCode::ValidationFailed, 422);
        }

        DB::transaction(function () use ($role, $permissions, $before) {
            $role->permissions()->sync(Permission::whereIn('name', $permissions)->pluck('id'));
            $role->users()->pluck('users.id')->each(fn (string $id) => SyncChanges::cashiers($id));
            $this->audit->record('role.permissions_changed', $role,
                ['permissions' => $before->sort()->values()->all()],
                ['permissions' => collect($permissions)->sort()->values()->all()]);
        });

        return $role;
    }

    public function delete(Role $role): void
    {
        if ($role->is_system) {
            throw new BusinessException('System roles cannot be deleted.', ErrorCode::BusinessRuleViolation, 409, ['reason' => 'system_role']);
        }
        if ($role->users()->exists()) {
            throw new BusinessException('Remove this role from all users before deleting it.', ErrorCode::Conflict, 409, ['reason' => 'role_in_use']);
        }

        DB::transaction(function () use ($role) {
            $this->audit->record('role.deleted', $role, ['name' => $role->name]);
            $role->delete();
        });
    }
}
