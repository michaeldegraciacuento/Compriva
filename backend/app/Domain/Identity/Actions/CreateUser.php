<?php

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Services\AccessControl;
use App\Models\Role;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use Illuminate\Support\Facades\DB;

class CreateUser
{
    public function __construct(
        private readonly AccessControl $access,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  array{name: string, username: string, email?: ?string, password: string, pin?: ?string, is_active?: bool}  $data
     * @param  list<string>  $roleIds
     */
    public function execute(User $actor, array $data, array $roleIds): User
    {
        $roles = Role::whereKey($roleIds)->get();
        $this->access->assertCanGrantRoles($actor, $roles);

        return DB::transaction(function () use ($data, $roles) {
            $user = User::create([
                'name' => $data['name'],
                'username' => $data['username'],
                'email' => $data['email'] ?? null,
                'password' => $data['password'],
                'pin_hash' => $data['pin'] ?? null,
                'is_active' => $data['is_active'] ?? true,
            ]);
            $user->roles()->sync($roles->modelKeys());

            $this->audit->record('user.created', $user, new: [
                'username' => $user->username, 'roles' => $roles->pluck('name')->all(), 'is_active' => $user->is_active,
            ]);

            return $user;
        });
    }
}
